export type InvestigationTargetInput = { type: 'global' } | { type: 'room'; roomId: number };

export interface InvestigationRoom {
  roomId: number;
  title: string;
  streamerName: string;
}

export interface InvestigationConversation {
  sessionId: string;
  target: InvestigationTargetInput;
  title: string;
  label: string;
  createdAt: number;
  room?: InvestigationRoom;
}

export interface InvestigationUpdate {
  type: 'title_updated';
  sessionId: string;
  title: string;
}

export interface InvestigationClient {
  list(): Promise<InvestigationConversation[]>;
  create(input: { target: InvestigationTargetInput }): Promise<InvestigationConversation>;
  rename(input: { sessionId: string; title: string }): Promise<InvestigationConversation>;
  delete(input: { sessionId: string }): Promise<void>;
  updates(
    input?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<InvestigationUpdate>>;
  prompt(input: { sessionId: string; content: string }): Promise<InvestigationConversation>;
  abort(input: { sessionId: string }): Promise<void>;
}
