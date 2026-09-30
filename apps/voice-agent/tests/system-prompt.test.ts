import { expect, test } from 'vite-plus/test';

import { VOICE_AGENT_SYSTEM_PROMPT } from '../src/system-prompt.ts';

test('描述多人语音聊天参与者角色', () => {
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('夏尔');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('群聊中的一位成员');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('speaker_0');
});

test('要求沉默是正常选择，不输出占位句', () => {
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('沉默是正常且重要的选择');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('不要宣布');
});

test('约束 speak 工具与 superseded 语义', () => {
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('只调用一次 speak 工具');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('superseded');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('delivered');
});

test('禁止把临时 speaker 标签当作真实名字', () => {
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('不要把 speaker_0 当作名字念出来');
});

test('禁止使用 Markdown 和舞台说明', () => {
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('不使用 Markdown');
  expect(VOICE_AGENT_SYSTEM_PROMPT).toContain('舞台说明');
});
