import {
  paddingToMatchBlockByBase64,
  resizeImgBase64,
} from '@midscene/shared/img';
import { maxPixelIndex } from '../shared/model-locate-result/bbox';
import type { PixelBbox } from '../shared/model-locate-result/types';

export interface ImagePreprocessPolicy {
  maxLongSide?: number | false;
  padBlockSize?: number;
}

export interface PreparedModelImage {
  imageBase64: string;
  /**
   * Size of the source image before model-only preprocessing. This remains the
   * coordinate space used by screenshots, reports, and executor actions.
   */
  sourceSize: {
    width: number;
    height: number;
  };
  /**
   * Size of the image sent to the model after preprocessing. This can be larger
   * than the original screenshot when padding is applied to satisfy model block
   * size requirements.
   */
  preparedSize: {
    width: number;
    height: number;
  };
  /**
   * Size of the real screenshot content inside the prepared image. Pixel bboxes
   * are parsed against `preparedSize`, then clipped to `contentSize` so padding
   * added for the model is not treated as valid UI content. If max-long-side
   * resizing is applied, this is the resized content size before padding.
   */
  contentSize: {
    width: number;
    height: number;
  };
}

function assertPositiveFiniteSize(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function resolveMaxLongSideSize(options: {
  width: number;
  height: number;
  maxLongSide: number | false | undefined;
}): { width: number; height: number } | undefined {
  const { width, height, maxLongSide } = options;
  if (maxLongSide === undefined || maxLongSide === false) {
    return undefined;
  }

  assertPositiveFiniteSize(maxLongSide, 'maxLongSide');
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) {
    return undefined;
  }

  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareModelImage(options: {
  imageBase64: string;
  width: number;
  height: number;
  policy: ImagePreprocessPolicy;
}): Promise<PreparedModelImage> {
  const { imageBase64, width, height, policy } = options;
  assertPositiveFiniteSize(width, 'width');
  assertPositiveFiniteSize(height, 'height');

  let preparedImageBase64 = imageBase64;
  let contentWidth = width;
  let contentHeight = height;

  const resizedSize = resolveMaxLongSideSize({
    width,
    height,
    maxLongSide: policy.maxLongSide,
  });
  if (resizedSize) {
    preparedImageBase64 = await resizeImgBase64(
      preparedImageBase64,
      resizedSize,
    );
    contentWidth = resizedSize.width;
    contentHeight = resizedSize.height;
  }

  let preparedWidth = contentWidth;
  let preparedHeight = contentHeight;

  if (policy.padBlockSize !== undefined) {
    const paddedResult = await paddingToMatchBlockByBase64(
      preparedImageBase64,
      policy.padBlockSize,
    );
    preparedImageBase64 = paddedResult.imageBase64;
    preparedWidth = paddedResult.width;
    preparedHeight = paddedResult.height;
  }

  return {
    imageBase64: preparedImageBase64,
    sourceSize: {
      width,
      height,
    },
    preparedSize: {
      width: preparedWidth,
      height: preparedHeight,
    },
    contentSize: {
      width: contentWidth,
      height: contentHeight,
    },
  };
}

export function mapModelPixelBboxToSourcePixelBbox(
  [left, top, right, bottom]: PixelBbox,
  preparedImage: Pick<PreparedModelImage, 'contentSize' | 'sourceSize'>,
): PixelBbox {
  const { contentSize, sourceSize } = preparedImage;
  const sourceMaxX = maxPixelIndex(sourceSize.width);
  const sourceMaxY = maxPixelIndex(sourceSize.height);
  const mapPixelIndex = (value: number, fromSize: number, toSize: number) => {
    const fromMax = maxPixelIndex(fromSize);
    if (fromMax === 0) {
      return 0;
    }
    return Math.round((value * maxPixelIndex(toSize)) / fromMax);
  };
  const mapX = (x: number) =>
    mapPixelIndex(x, contentSize.width, sourceSize.width);
  const mapY = (y: number) =>
    mapPixelIndex(y, contentSize.height, sourceSize.height);
  const clampX = (x: number) => Math.min(Math.max(x, 0), sourceMaxX);
  const clampY = (y: number) => Math.min(Math.max(y, 0), sourceMaxY);

  return [
    clampX(mapX(left)),
    clampY(mapY(top)),
    clampX(mapX(right)),
    clampY(mapY(bottom)),
  ];
}
