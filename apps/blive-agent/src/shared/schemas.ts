import { Type } from 'typebox';

export const PositiveIntegerSchema = Type.Integer({ minimum: 1 });

const followModeSchema = Type.Object({
  type: Type.Literal('follow'),
  roomId: PositiveIntegerSchema,
});

const exploreModeSchema = Type.Object({
  type: Type.Literal('explore'),
  areaId: PositiveIntegerSchema,
});

const requiredStringSchema = Type.String({ minLength: 1 });

const recordingSourceSchema = Type.Union([
  Type.Object({ type: Type.Literal('url'), url: requiredStringSchema }),
  Type.Object({ type: Type.Literal('file'), path: requiredStringSchema }),
]);

const recordingModeSchema = Type.Object({
  type: Type.Literal('recording'),
  roomId: PositiveIntegerSchema,
  source: recordingSourceSchema,
  date: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});

const watchModeSchema = Type.Union([followModeSchema, exploreModeSchema, recordingModeSchema]);
const danmakuDeliverySchema = Type.Union([Type.Literal('simulate'), Type.Literal('live')]);

export const StartWatchSchema = Type.Object({
  mode: watchModeSchema,
  danmakuDelivery: Type.Optional(danmakuDeliverySchema),
});

export const AccountSchema = Type.Object({
  uid: PositiveIntegerSchema,
  name: Type.String({ minLength: 1 }),
  face: Type.String(),
});

export const OptionalAccountSchema = Type.Union([AccountSchema, Type.Null()]);

export const LivePageReadinessSchema = Type.Object({
  roomId: Type.Union([PositiveIntegerSchema, Type.Null()]),
  ready: Type.Boolean(),
  canSendDanmaku: Type.Boolean(),
});

export const DanmakuPageResultSchema = Type.Object({
  accepted: Type.Boolean(),
  code: Type.Union([Type.Number(), Type.Null()]),
  message: Type.String(),
  riskControl: Type.Boolean(),
});
