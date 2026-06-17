import { getModelRuntime } from '@/ai-model/models';
import { callAIWithObjectResponse } from '@/ai-model/service-caller/index';
import {
  AiLocateElement,
  AiLocateSection,
  buildSearchAreaConfig,
} from '@/ai-model/workflows/inspect';
import type { UIContext } from '@/types';
import type { IModelConfig } from '@midscene/shared/env';
import { cropByRect, resizeImgBase64, scaleImage } from '@midscene/shared/img';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ai-model/service-caller/index', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/ai-model/service-caller/index')>();
  return {
    ...actual,
    callAIWithObjectResponse: vi.fn(),
  };
});

vi.mock('@midscene/shared/img', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midscene/shared/img')>();
  return {
    ...actual,
    cropByRect: vi.fn(),
    resizeImgBase64: vi.fn().mockResolvedValue('resized-image'),
    scaleImage: vi.fn(),
  };
});

const modelConfig: IModelConfig = {
  modelFamily: 'qwen3-vl',
  modelName: 'test-model',
  modelDescription: 'test-model-desc',
  intent: 'default',
  slot: 'default',
};

function createContext(width = 3024, height = 1964): UIContext {
  return {
    screenshot: {
      base64: 'original-screenshot',
    } as any,
    shotSize: {
      width,
      height,
    },
    shrunkShotToLogicalRatio: 1,
  };
}

describe('inspect image resize coordinate mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resizeImgBase64).mockResolvedValue('resized-image');
  });

  it('maps locate bbox from resized model image back to original screenshot coordinates', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValue({
      content: {
        bbox: [0, 0, 1000, 1000],
      },
      usage: undefined,
      contentString: '{"bbox":[0,0,1000,1000]}',
      reasoning_content: undefined,
    });

    const result = await AiLocateElement({
      context: createContext(),
      targetElementDescription: 'target',
      modelRuntime: getModelRuntime(modelConfig),
    });

    expect(resizeImgBase64).toHaveBeenCalledWith('original-screenshot', {
      width: 1920,
      height: 1247,
    });
    expect(result.rect).toEqual({
      left: 0,
      top: 0,
      width: 3024,
      height: 1964,
    });
    expect(result.parseResult.element?.center).toEqual([1511, 981]);
  });

  it('maps resized search-area locate results through source crop mapping', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValue({
      content: {
        bbox: [0, 0, 1000, 1000],
      },
      usage: undefined,
      contentString: '{"bbox":[0,0,1000,1000]}',
      reasoning_content: undefined,
    });

    const result = await AiLocateElement({
      context: createContext(),
      targetElementDescription: 'target',
      modelRuntime: getModelRuntime(modelConfig),
      searchConfig: {
        sourceRect: {
          left: 100,
          top: 200,
          width: 800,
          height: 600,
        },
        image: {
          imageBase64: 'scaled-search-area',
          width: 1600,
          height: 1200,
        },
        mapping: {
          offset: {
            x: 100,
            y: 200,
          },
          scale: 2,
        },
      },
    });

    expect(resizeImgBase64).not.toHaveBeenCalled();
    expect(result.rect).toEqual({
      left: 100,
      top: 200,
      width: 801,
      height: 601,
    });
    expect(result.parseResult.element?.center).toEqual([500, 500]);
  });

  it('maps section locate bbox back before building deep locate search area', async () => {
    vi.mocked(callAIWithObjectResponse).mockResolvedValue({
      content: {
        bbox: [0, 0, 1000, 1000],
      },
      usage: undefined,
      contentString: '{"bbox":[0,0,1000,1000]}',
      reasoning_content: undefined,
    });
    vi.mocked(cropByRect).mockResolvedValue({
      imageBase64: 'cropped-section',
      width: 3024,
      height: 1964,
    } as any);
    vi.mocked(scaleImage).mockResolvedValue({
      imageBase64: 'scaled-section',
      width: 6048,
      height: 3928,
    } as any);

    const result = await AiLocateSection({
      context: createContext(),
      sectionDescription: 'main content',
      modelRuntime: getModelRuntime(modelConfig),
    });

    expect(cropByRect).toHaveBeenCalledWith('original-screenshot', {
      left: 0,
      top: 0,
      width: 3024,
      height: 1964,
    });
    expect(result.searchAreaConfig?.sourceRect).toEqual({
      left: 0,
      top: 0,
      width: 3024,
      height: 1964,
    });
  });

  it('keeps buildSearchAreaConfig crop and scale mapping explicit', async () => {
    vi.mocked(cropByRect).mockResolvedValue({
      imageBase64: 'cropped-image',
      width: 400,
      height: 400,
    } as any);
    vi.mocked(scaleImage).mockResolvedValue({
      imageBase64: 'scaled-image',
      width: 800,
      height: 800,
    } as any);

    const searchArea = await buildSearchAreaConfig({
      context: createContext(1000, 800),
      baseRect: {
        left: 450,
        top: 350,
        width: 100,
        height: 100,
      },
    });

    expect(searchArea.mapping).toEqual({
      offset: {
        x: 300,
        y: 200,
      },
      scale: 2,
    });
  });
});
