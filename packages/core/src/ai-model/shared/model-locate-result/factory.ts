import { createLocateResultPromptSpec } from '../../prompts/locate-result-coordinates';
import {
  finalizePixelBbox,
  finalizeSectionLocatePixelBboxGroup,
  maxPixelIndex,
} from './bbox';
import { parseNumericLocateResult } from './parse';
import { mapLocateResultToPixelBboxByCoordinates } from './pixel-bbox-mapper';
import type {
  LocateResultAdapter,
  LocateResultAdapterDefinition,
  LocateResultContext,
  LocateResultCoordinates,
  PixelBbox,
  ResolvedLocateResultCoordinates,
  SectionLocatePixelBboxGroup,
  StandardLocateResultAdapterDefinition,
} from './types';

type RawLocateValuePurpose = 'primary' | 'references';

const rawLocateValueFields = {
  primary: {
    bbox: ['bbox', 'bbox_2d'],
    point: ['point'],
  },
  references: {
    bbox: ['references_bbox', 'references_bbox_2d'],
    point: ['references_point'],
  },
} as const;

function resolveLocateResultCoordinates(
  coordinates: LocateResultCoordinates,
): ResolvedLocateResultCoordinates {
  const order = coordinates.order ?? 'xy';
  if (coordinates.normalizedBy !== undefined && coordinates.normalizedBy <= 0) {
    throw new Error(
      `locate result coordinates normalizedBy must be positive: ${coordinates.normalizedBy}`,
    );
  }
  return {
    shape: coordinates.shape,
    order,
    normalizedBy: coordinates.normalizedBy,
  };
}

function extractFirstObjectField(
  input: unknown,
  fields: readonly string[],
): unknown | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const matchedField = fields.find((field) => record[field] !== undefined);
  return matchedField ? record[matchedField] : undefined;
}

function normalizeReferenceResults(input: unknown): unknown[] {
  if (input === undefined || input === null) {
    return [];
  }
  return Array.isArray(input) ? input : [input];
}

function pickRawLocateValue(
  input: unknown,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
  purpose: RawLocateValuePurpose,
): unknown | undefined {
  const fields = rawLocateValueFields[purpose][resolvedCoordinates.shape];
  return extractFirstObjectField(input, fields);
}

function pointFallbackCoordinates(
  resolvedCoordinates: ResolvedLocateResultCoordinates,
): ResolvedLocateResultCoordinates {
  return {
    shape: 'point',
    order: resolvedCoordinates.order,
    normalizedBy: resolvedCoordinates.normalizedBy,
  };
}

function extractRawLocateValueWithCoordinates(
  input: unknown,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
  purpose: RawLocateValuePurpose,
):
  | {
      rawValue: unknown;
      coordinates: ResolvedLocateResultCoordinates;
    }
  | undefined {
  const pickedRawResult = pickRawLocateValue(
    input,
    resolvedCoordinates,
    purpose,
  );
  if (pickedRawResult !== undefined) {
    return {
      rawValue: pickedRawResult,
      coordinates: resolvedCoordinates,
    };
  }

  if (resolvedCoordinates.shape !== 'point') {
    const fallbackCoordinates = pointFallbackCoordinates(resolvedCoordinates);
    const pickedPoint = pickRawLocateValue(input, fallbackCoordinates, purpose);
    if (pickedPoint !== undefined) {
      return {
        rawValue: pickedPoint,
        coordinates: fallbackCoordinates,
      };
    }
  }

  return undefined;
}

function extractPrimaryRawLocateValue(
  input: unknown,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
): {
  rawValue: unknown;
  coordinates: ResolvedLocateResultCoordinates;
} {
  const pickedRawResult = extractRawLocateValueWithCoordinates(
    input,
    resolvedCoordinates,
    'primary',
  );
  if (pickedRawResult !== undefined) {
    return pickedRawResult;
  }

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      rawValue: input,
      coordinates: resolvedCoordinates,
    };
  }

  throw new Error(
    'locate response does not contain a recognizable locate result field',
  );
}

function extractReferenceRawLocateValues(
  input: unknown,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
): Array<{
  rawValue: unknown;
  coordinates: ResolvedLocateResultCoordinates;
}> {
  const pickedReferences = extractRawLocateValueWithCoordinates(
    input,
    resolvedCoordinates,
    'references',
  );

  return normalizeReferenceResults(pickedReferences?.rawValue).map(
    (rawValue) => ({
      rawValue,
      coordinates: pickedReferences?.coordinates ?? resolvedCoordinates,
    }),
  );
}

function parseRawLocateValueByCoordinates(
  input: unknown,
  coordinates: ResolvedLocateResultCoordinates,
  customParser?: StandardLocateResultAdapterDefinition['parseRawLocateValue'],
) {
  return customParser
    ? customParser(input)
    : parseNumericLocateResult(coordinates, input);
}

function createDefaultPixelBboxMapper(
  config: StandardLocateResultAdapterDefinition,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
) {
  return (rawValue: unknown, ctx: LocateResultContext) =>
    mapLocateResultToPixelBboxByCoordinates(
      parseRawLocateValueByCoordinates(
        rawValue,
        resolvedCoordinates,
        config.parseRawLocateValue,
      ),
      ctx,
      resolvedCoordinates,
    );
}

function createCustomPixelBboxMapper(
  config: StandardLocateResultAdapterDefinition,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
) {
  return (rawValue: unknown, ctx: LocateResultContext) =>
    config.mapLocateResultToPixelBbox!(
      parseRawLocateValueByCoordinates(
        rawValue,
        resolvedCoordinates,
        config.parseRawLocateValue,
      ),
      ctx,
    );
}

function mapPointFallbackToOnePixelBbox(
  rawValue: unknown,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
  ctx: LocateResultContext,
): PixelBbox {
  const result = parseNumericLocateResult(resolvedCoordinates, rawValue);
  if (result.type !== 'point') {
    throw new Error(`invalid point data: ${JSON.stringify(rawValue)} `);
  }

  // Reuse the standard mapper's validation for coordinate range and order.
  mapLocateResultToPixelBboxByCoordinates(result, ctx, resolvedCoordinates);

  const [x, y] =
    resolvedCoordinates.order === 'yx'
      ? [result.coordinates[1], result.coordinates[0]]
      : result.coordinates;
  const pixelPoint: [number, number] =
    resolvedCoordinates.normalizedBy === undefined
      ? [Math.round(x), Math.round(y)]
      : [
          Math.round(
            (x * maxPixelIndex(ctx.preparedSize.width)) /
              resolvedCoordinates.normalizedBy,
          ),
          Math.round(
            (y * maxPixelIndex(ctx.preparedSize.height)) /
              resolvedCoordinates.normalizedBy,
          ),
        ];

  return [pixelPoint[0], pixelPoint[1], pixelPoint[0], pixelPoint[1]];
}

function createRawLocateValuePixelBboxMapper(
  config: StandardLocateResultAdapterDefinition,
  resolvedCoordinates: ResolvedLocateResultCoordinates,
) {
  const defaultMapper = createDefaultPixelBboxMapper(
    config,
    resolvedCoordinates,
  );
  const customMapper = config.mapLocateResultToPixelBbox
    ? createCustomPixelBboxMapper(config, resolvedCoordinates)
    : undefined;

  return (
    rawResult: {
      rawValue: unknown;
      coordinates: ResolvedLocateResultCoordinates;
    },
    ctx: LocateResultContext,
  ) => {
    const isPointFallback =
      resolvedCoordinates.shape !== 'point' &&
      rawResult.coordinates.shape === 'point';
    if (isPointFallback) {
      return mapPointFallbackToOnePixelBbox(
        rawResult.rawValue,
        rawResult.coordinates,
        ctx,
      );
    }

    return customMapper
      ? customMapper(rawResult.rawValue, ctx)
      : defaultMapper(rawResult.rawValue, ctx);
  };
}

function createStandardLocateResultAdapterImplementation(
  config: StandardLocateResultAdapterDefinition,
): LocateResultAdapter {
  const resolvedCoordinates = resolveLocateResultCoordinates(
    config.coordinates,
  );
  const mapRawLocateValueToPixelBbox = createRawLocateValuePixelBboxMapper(
    config,
    resolvedCoordinates,
  );
  // Keep error semantics out of the adapter: callers may preserve, ignore, or
  // fail fast on `error` / `errors`, while this layer only extracts coordinates.
  const adaptRawLocateInputToPixelBbox = (
    input: unknown,
    ctx: LocateResultContext,
  ): PixelBbox =>
    mapRawLocateValueToPixelBbox(
      extractPrimaryRawLocateValue(input, resolvedCoordinates),
      ctx,
    );
  const adaptElementLocateResultToPixelBbox = (
    input: unknown,
    ctx: LocateResultContext,
  ): PixelBbox => adaptRawLocateInputToPixelBbox(input, ctx);
  const adaptPlanningParamToPixelBbox = (
    input: unknown,
    ctx: LocateResultContext,
  ): PixelBbox => adaptRawLocateInputToPixelBbox(input, ctx);
  const adaptSectionLocateResultToPixelBboxGroup = (
    input: unknown,
    ctx: LocateResultContext,
  ): SectionLocatePixelBboxGroup => {
    const target = adaptRawLocateInputToPixelBbox(input, ctx);
    const references = extractReferenceRawLocateValues(
      input,
      resolvedCoordinates,
    ).map((raw) => mapRawLocateValueToPixelBbox(raw, ctx));
    return {
      target,
      ...(references.length > 0 ? { references } : {}),
    };
  };
  return {
    kind: 'standard',
    promptSpec: createLocateResultPromptSpec(resolvedCoordinates),
    adaptElementLocateResultToPixelBbox,
    adaptSectionLocateResultToPixelBboxGroup,
    adaptPlanningParamToPixelBbox,
  };
}

export function createLocateResultAdapter(
  config: LocateResultAdapterDefinition,
): LocateResultAdapter {
  const adapter: LocateResultAdapter =
    config.kind === 'custom'
      ? config
      : createStandardLocateResultAdapterImplementation(config);

  return {
    kind: adapter.kind,
    promptSpec: adapter.promptSpec,
    adaptElementLocateResultToPixelBbox: (input, ctx) =>
      finalizePixelBbox(
        adapter.adaptElementLocateResultToPixelBbox(input, ctx),
        input,
        ctx,
      ),
    adaptSectionLocateResultToPixelBboxGroup: (input, ctx) =>
      finalizeSectionLocatePixelBboxGroup(
        adapter.adaptSectionLocateResultToPixelBboxGroup(input, ctx),
        input,
        ctx,
      ),
    adaptPlanningParamToPixelBbox: (input, ctx) =>
      finalizePixelBbox(
        adapter.adaptPlanningParamToPixelBbox(input, ctx),
        input,
        ctx,
      ),
  };
}
