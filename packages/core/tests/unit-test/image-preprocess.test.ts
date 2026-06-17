import {
  mapModelPixelBboxToSourcePixelBbox,
  prepareModelImage,
} from '@/ai-model/workflows/image-preprocess';
import { buildSearchAreaConfig } from '@/ai-model/workflows/inspect';
import {
  cropByRect,
  paddingToMatchBlockByBase64,
  resizeImgBase64,
  scaleImage,
} from '@midscene/shared/img';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@midscene/shared/img', () => ({
  compositeElementInfoImg: vi.fn(),
  cropByRect: vi.fn(),
  paddingToMatchBlockByBase64: vi.fn(),
  resizeImgBase64: vi.fn(),
  scaleImage: vi.fn(),
}));

describe('prepareModelImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the original image and size when no padding policy is configured', async () => {
    const image = await prepareModelImage({
      imageBase64: 'original-image',
      width: 101,
      height: 77,
      policy: {},
    });

    expect(image).toEqual({
      imageBase64: 'original-image',
      sourceSize: {
        width: 101,
        height: 77,
      },
      preparedSize: {
        width: 101,
        height: 77,
      },
      contentSize: {
        width: 101,
        height: 77,
      },
    });
    expect(resizeImgBase64).not.toHaveBeenCalled();
    expect(paddingToMatchBlockByBase64).not.toHaveBeenCalled();
  });

  it('resizes large images by max long side while preserving aspect ratio', async () => {
    vi.mocked(resizeImgBase64).mockResolvedValue('resized-image');

    const image = await prepareModelImage({
      imageBase64: 'original-image',
      width: 3024,
      height: 1964,
      policy: {
        maxLongSide: 1920,
      },
    });

    expect(resizeImgBase64).toHaveBeenCalledWith('original-image', {
      width: 1920,
      height: 1247,
    });
    expect(image).toEqual({
      imageBase64: 'resized-image',
      sourceSize: {
        width: 3024,
        height: 1964,
      },
      preparedSize: {
        width: 1920,
        height: 1247,
      },
      contentSize: {
        width: 1920,
        height: 1247,
      },
    });
  });

  it('does not enlarge images below maxLongSide', async () => {
    const image = await prepareModelImage({
      imageBase64: 'original-image',
      width: 800,
      height: 600,
      policy: {
        maxLongSide: 1920,
      },
    });

    expect(resizeImgBase64).not.toHaveBeenCalled();
    expect(image.preparedSize).toEqual({ width: 800, height: 600 });
    expect(image.contentSize).toEqual({ width: 800, height: 600 });
    expect(image.sourceSize).toEqual({ width: 800, height: 600 });
  });

  it('disables max-long-side resizing when maxLongSide is false', async () => {
    const image = await prepareModelImage({
      imageBase64: 'original-image',
      width: 3024,
      height: 1964,
      policy: {
        maxLongSide: false,
      },
    });

    expect(resizeImgBase64).not.toHaveBeenCalled();
    expect(image.preparedSize).toEqual({ width: 3024, height: 1964 });
    expect(image.contentSize).toEqual({ width: 3024, height: 1964 });
    expect(image.sourceSize).toEqual({ width: 3024, height: 1964 });
  });

  it('pads after resizing and keeps contentSize as the resized content size', async () => {
    vi.mocked(resizeImgBase64).mockResolvedValue('resized-image');
    vi.mocked(paddingToMatchBlockByBase64).mockResolvedValue({
      imageBase64: 'padded-image',
      width: 1932,
      height: 1260,
    } as any);

    const image = await prepareModelImage({
      imageBase64: 'original-image',
      width: 3024,
      height: 1964,
      policy: {
        maxLongSide: 1920,
        padBlockSize: 28,
      },
    });

    expect(resizeImgBase64).toHaveBeenCalledWith('original-image', {
      width: 1920,
      height: 1247,
    });
    expect(paddingToMatchBlockByBase64).toHaveBeenCalledWith(
      'resized-image',
      28,
    );
    expect(image).toEqual({
      imageBase64: 'padded-image',
      sourceSize: {
        width: 3024,
        height: 1964,
      },
      preparedSize: {
        width: 1932,
        height: 1260,
      },
      contentSize: {
        width: 1920,
        height: 1247,
      },
    });
  });

  it('maps model pixel bbox back to source image coordinates', () => {
    expect(
      mapModelPixelBboxToSourcePixelBbox([0, 0, 1919, 1246], {
        sourceSize: {
          width: 3024,
          height: 1964,
        },
        contentSize: {
          width: 1920,
          height: 1247,
        },
      }),
    ).toEqual([0, 0, 3023, 1963]);

    expect(
      mapModelPixelBboxToSourcePixelBbox([960, 623, 960, 623], {
        sourceSize: {
          width: 3024,
          height: 1964,
        },
        contentSize: {
          width: 1920,
          height: 1247,
        },
      }),
    ).toEqual([1512, 982, 1512, 982]);
  });
});

describe('buildSearchAreaConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crops the expanded area, scales it, and records offset/scale mapping', async () => {
    const cropCalls: unknown[] = [];
    vi.mocked(cropByRect).mockImplementation(async (_imageBase64, rect) => {
      cropCalls.push({ ...rect });
      return {
        imageBase64: 'cropped-image',
        width: 400,
        height: 400,
      } as any;
    });
    vi.mocked(scaleImage).mockResolvedValue({
      imageBase64: 'scaled-image',
      width: 800,
      height: 800,
    } as any);

    const searchArea = await buildSearchAreaConfig({
      context: {
        screenshot: {
          base64: 'full-screenshot',
        },
        shotSize: {
          width: 1000,
          height: 800,
        },
      } as any,
      baseRect: {
        left: 450,
        top: 350,
        width: 100,
        height: 100,
      },
    });

    expect(cropByRect).toHaveBeenCalledWith(
      'full-screenshot',
      expect.any(Object),
    );
    expect(cropCalls).toEqual([
      {
        left: 300,
        top: 200,
        width: 400,
        height: 400,
      },
    ]);
    expect(scaleImage).toHaveBeenCalledWith('cropped-image', 2);
    expect(searchArea).toEqual({
      sourceRect: {
        left: 300,
        top: 200,
        width: 400,
        height: 400,
      },
      image: {
        imageBase64: 'scaled-image',
        width: 800,
        height: 800,
      },
      mapping: {
        offset: {
          x: 300,
          y: 200,
        },
        scale: 2,
      },
    });
  });
});
