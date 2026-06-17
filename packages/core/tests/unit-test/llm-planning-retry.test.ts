import { ConversationHistory } from '@/ai-model/conversation-history';
import { plan } from '@/ai-model/llm-planning';
import { getModelRuntime } from '@/ai-model/models';
import { callAI } from '@/ai-model/service-caller/index';
import { getMidsceneLocationSchema } from '@/common';
import type { DeviceAction, UIContext } from '@/types';
import type { IModelConfig } from '@midscene/shared/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/ai-model/service-caller/index', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/ai-model/service-caller/index')>();
  return {
    ...actual,
    callAI: vi.fn(),
  };
});

vi.mock('@midscene/shared/img', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midscene/shared/img')>();
  return {
    ...actual,
    resizeImgBase64: vi.fn().mockResolvedValue('resized-image'),
  };
});

const mockAIResponse = (content: string) => ({
  content,
  isStreamed: false,
});

const mockModelConfig = (): IModelConfig => ({
  modelName: 'mock-model',
  modelDescription: 'mock model',
  intent: 'planning',
  slot: 'planning',
});

const mockContext = (): UIContext =>
  ({
    screenshot: {
      base64: 'data:image/png;base64,AA==',
    },
    shotSize: {
      width: 100,
      height: 100,
    },
  }) as UIContext;

const mockActionSpace = (): DeviceAction[] => [
  {
    name: 'Tap',
    description: 'Tap an element',
    call: vi.fn(),
  },
];

const mockActionSpaceWithLocate = (): DeviceAction[] => [
  {
    name: 'Tap',
    description: 'Tap an element',
    paramSchema: z.object({
      locate: getMidsceneLocationSchema(),
    }),
    call: vi.fn(),
  },
];

const latestImageDetail = () => {
  const messages = vi.mocked(callAI).mock.calls[0]?.[0];
  const latestMessage = messages?.at(-1);
  const imagePart = Array.isArray(latestMessage?.content)
    ? latestMessage.content.find((part) => part.type === 'image_url')
    : undefined;
  return imagePart?.image_url.detail;
};

const latestCallAIOptions = () => vi.mocked(callAI).mock.calls[0]?.[2];

describe('plan XML parse retry', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('should retry once when XML response parsing fails', async () => {
    vi.mocked(callAI)
      .mockResolvedValueOnce(
        mockAIResponse(`<log>Tap button</log>
<action-type>Tap</action-type>
<action-param-json>{invalid json}</action-param-json>`),
      )
      .mockResolvedValueOnce(
        mockAIResponse(`<log>Tap button after retry</log>
<action-type>Tap</action-type>`),
      );

    const result = await plan('tap the button', {
      context: mockContext(),
      actionSpace: mockActionSpace(),
      modelRuntime: getModelRuntime(mockModelConfig()),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: false,
      deepThink: false,
    });

    expect(callAI).toHaveBeenCalledTimes(2);
    expect(result.rawResponse).toContain('Tap button after retry');
    expect(result.actions).toEqual([{ type: 'Tap' }]);
  });

  it('should tell the model when no previous aiAct actions have been executed', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      mockAIResponse(`<log>Tap button</log>
<action-type>Tap</action-type>`),
    );

    await plan('terminate the app, launch it, then tap the AI button', {
      context: mockContext(),
      actionSpace: mockActionSpace(),
      modelRuntime: getModelRuntime(mockModelConfig()),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: false,
      deepThink: false,
    });

    const messages = vi.mocked(callAI).mock.calls[0]?.[0];
    const latestMessage = messages?.at(-1);
    const textPart = Array.isArray(latestMessage?.content)
      ? latestMessage.content.find((part) => part.type === 'text')
      : undefined;

    expect(textPart?.text).toContain('This is the current screenshot.');
    expect(textPart?.text).toContain(
      'No previous actions have been executed in this aiAct execution yet.',
    );
    expect(textPart?.text).toContain(
      'If the instruction asks for actions, choose the first action to execute.',
    );
  });

  it('marks planning as requiring original image detail when locate is included', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      mockAIResponse(`<log>Tap button</log>
<action-type>Tap</action-type>`),
    );

    await plan('tap the button', {
      context: mockContext(),
      actionSpace: mockActionSpace(),
      modelRuntime: getModelRuntime({
        ...mockModelConfig(),
        modelFamily: 'qwen3-vl',
      }),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: true,
      deepThink: false,
    });

    expect(latestImageDetail()).toBe('high');
    expect(latestCallAIOptions()?.requiresOriginalImageDetail).toBe(true);
  });

  it('maps planning point locate params into a one-pixel bbox', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      mockAIResponse(`<log>Tap button</log>
<action-type>Tap</action-type>
<action-param-json>{"locate":{"prompt":"the target position","point":[500,250]}}</action-param-json>`),
    );

    const result = await plan('tap the button', {
      context: {
        ...mockContext(),
        shotSize: {
          width: 200,
          height: 100,
        },
      },
      actionSpace: mockActionSpaceWithLocate(),
      modelRuntime: getModelRuntime({
        ...mockModelConfig(),
        modelFamily: 'qwen3-vl',
      }),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: true,
      deepThink: false,
    });

    expect(result.actions).toBeDefined();
    const [action] = result.actions!;
    expect(action).toMatchObject({
      type: 'Tap',
      param: {
        locate: {
          prompt: 'the target position',
          point: [500, 250],
          locatedPixelBbox: [100, 25, 100, 25],
        },
      },
    });
  });

  it('keeps prompt-only locate params for follow-up locate tasks', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      mockAIResponse(`<log>Scroll list</log>
<action-type>Scroll</action-type>
<action-param-json>{"direction":"down","scrollType":"singleAction","locate":{"prompt":"the weather style list area"}}</action-param-json>`),
    );

    const result = await plan('generate spring cherry blossoms', {
      context: mockContext(),
      actionSpace: [
        {
          name: 'Scroll',
          description: 'Scroll an area',
          paramSchema: z.object({
            direction: z.enum(['down', 'up', 'left', 'right']),
            scrollType: z.enum(['singleAction']),
            locate: getMidsceneLocationSchema().optional(),
          }),
          call: vi.fn(),
        },
      ],
      modelRuntime: getModelRuntime({
        ...mockModelConfig(),
        modelFamily: 'qwen3-vl',
      }),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: true,
      deepThink: false,
    });

    expect(result.actions).toBeDefined();
    const [action] = result.actions!;
    expect(action).toMatchObject({
      type: 'Scroll',
      param: {
        direction: 'down',
        scrollType: 'singleAction',
        locate: {
          prompt: 'the weather style list area',
        },
      },
    });
    expect(action.param.locate).not.toHaveProperty('locatedPixelBbox');
  });

  it('maps planning locate bbox from resized model image back to screenshot coordinates', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      mockAIResponse(`<log>Tap button</log>
<action-type>Tap</action-type>
<action-param-json>{"locate":{"prompt":"the target","bbox":[0,0,1000,1000]}}</action-param-json>`),
    );

    const result = await plan('tap the button', {
      context: {
        ...mockContext(),
        shotSize: {
          width: 3024,
          height: 1964,
        },
      },
      actionSpace: mockActionSpaceWithLocate(),
      modelRuntime: getModelRuntime({
        ...mockModelConfig(),
        modelFamily: 'qwen3-vl',
      }),
      conversationHistory: new ConversationHistory(),
      includeLocateInPlanning: true,
      deepThink: false,
    });

    expect(result.actions).toBeDefined();
    const [action] = result.actions!;
    expect(action).toMatchObject({
      type: 'Tap',
      param: {
        locate: {
          prompt: 'the target',
          bbox: [0, 0, 1000, 1000],
          locatedPixelBbox: [0, 0, 3023, 1963],
        },
      },
    });
  });
});
