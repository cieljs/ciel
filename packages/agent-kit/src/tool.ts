import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';
import { type Static, type TSchema } from 'typebox';

export interface ToolExecuteContext<TDetails = unknown> {
  toolCallId: string;

  signal?: AbortSignal;

  onUpdate?: AgentToolUpdateCallback<TDetails>;
}

type ToolDefinition<TParameters extends TSchema, TDetails = unknown> = Omit<
  AgentTool<TParameters, TDetails>,
  'parameters' | 'execute'
> & {
  execute: (
    params: Static<TParameters>,
    context: ToolExecuteContext<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
};

export function defineTool<
  TDetails = unknown,
  TArgs extends unknown[] = unknown[],
  TParameters extends TSchema = TSchema,
>(
  parameters: TParameters,
  factory: (...args: TArgs) => ToolDefinition<TParameters, TDetails>,
): (...args: TArgs) => AgentTool<TParameters, TDetails> {
  return (...args) => {
    const definition = factory(...args);

    return {
      ...definition,
      parameters,
      async execute(toolCallId, params, signal, onUpdate) {
        return definition.execute(params, {
          toolCallId,
          signal,
          onUpdate,
        });
      },
    };
  };
}
