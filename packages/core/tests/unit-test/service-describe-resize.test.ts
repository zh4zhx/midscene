import { getModelRuntime } from '@/ai-model/models';
import { callAIWithObjectResponse } from '@/ai-model/service-caller/index';
import Service from '@/service';
import type { UIContext } from '@/types';
import type { IModelConfig } from '@midscene/shared/env';
import {
  compositeElementInfoImg,
  cropByRect,
  resizeImgBase64,
} from '@midscene/shared/img';
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
    compositeElementInfoImg: vi.fn().mockResolvedValue('composited-image'),
    cropByRect: vi.fn(),
    resizeImgBase64: vi.fn().mockResolvedValue('resized-describe-image'),
  };
});

const modelConfig: IModelConfig = {
  modelFamily: 'qwen3-vl',
  modelName: 'test-model',
  modelDescription: 'test-model-desc',
  intent: 'insight',
  slot: 'insight',
};

function createContext(): UIContext {
  return {
    screenshot: {
      base64: 'original-screenshot',
    } as any,
    shotSize: {
      width: 3024,
      height: 1964,
    },
    shrunkShotToLogicalRatio: 1,
  };
}

function latestDescribeImageUrl() {
  const msgs = vi.mocked(callAIWithObjectResponse).mock.calls[0]?.[0];
  const imagePart = msgs?.[1]?.content?.[0];
  return imagePart?.type === 'image_url' ? imagePart.image_url.url : undefined;
}

describe('Service.describe image resize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callAIWithObjectResponse).mockResolvedValue({
      content: {
        description: 'button',
      },
      usage: undefined,
      contentString: '{"description":"button"}',
      reasoning_content: undefined,
    });
  });

  it('resizes the composited describe image before sending it to the model', async () => {
    const service = new Service(createContext());

    await service.describe(
      {
        left: 100,
        top: 200,
        width: 50,
        height: 30,
      },
      getModelRuntime(modelConfig),
    );

    expect(compositeElementInfoImg).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImgBase64: 'original-screenshot',
        size: {
          width: 3024,
          height: 1964,
        },
      }),
    );
    expect(resizeImgBase64).toHaveBeenCalledWith('composited-image', {
      width: 1920,
      height: 1247,
    });
    expect(latestDescribeImageUrl()).toBe('resized-describe-image');
  });

  it('resizes the cropped deepLocate describe image by the crop size', async () => {
    vi.mocked(cropByRect).mockResolvedValue({
      imageBase64: 'cropped-describe-image',
      width: 600,
      height: 1200,
    } as any);
    const service = new Service(createContext());

    await service.describe([200, 300], getModelRuntime(modelConfig), {
      deepLocate: true,
    });

    expect(resizeImgBase64).not.toHaveBeenCalled();
    expect(latestDescribeImageUrl()).toBe('cropped-describe-image');
  });
});
