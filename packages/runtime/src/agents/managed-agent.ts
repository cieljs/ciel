import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';

type ManagedAgentOptions = ConstructorParameters<typeof Agent>[0] & {
  prepareRun: () => Promise<void>;
};

export class ManagedAgent extends Agent {
  private readonly prepareRun: () => Promise<void>;

  constructor({ prepareRun, ...options }: ManagedAgentOptions) {
    super(options);
    this.prepareRun = prepareRun;
  }

  override async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  override async prompt(input: string, images?: ImageContent[]): Promise<void>;
  override async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): Promise<void> {
    await this.prepareRun();

    if (typeof input === 'string') {
      await super.prompt(input, images);
    } else {
      await super.prompt(input);
    }

    this.throwRunError();
  }

  override async continue(): Promise<void> {
    await this.prepareRun();
    await super.continue();
    this.throwRunError();
  }

  private throwRunError() {
    if (this.state.errorMessage) {
      throw new Error(`Agent 运行失败：${this.state.errorMessage}`);
    }
  }
}
