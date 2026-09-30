type Prompt = {
  /**
   * 创建原始 Prompt 字符串
   *
   * 基于 `String.raw`, 保留模板字符串中的转义字符
   */
  (strings: TemplateStringsArray, ...values: unknown[]): string;

  /**
   * 创建并裁剪 Prompt 字符串
   *
   * 会移除字符串首尾空白
   */
  trim(strings: TemplateStringsArray, ...values: unknown[]): string;

  /**
   * 创建并整理缩进的 Prompt 字符串
   *
   * 会移除所有非空行共有的最小缩进,
   * 并裁剪字符串首尾空白
   */
  dedent(strings: TemplateStringsArray, ...values: unknown[]): string;

  /**
   * 创建单行 Prompt 字符串。
   *
   * 会移除首尾空白，并将连续空白折叠为单个空格。
   */
  inline(strings: TemplateStringsArray, ...values: unknown[]): string;
};

/**
 * Prompt 模板字符串辅助函数
 */
export const prompt: Prompt = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    return String.raw({ raw: strings }, ...values);
  },

  {
    trim(strings: TemplateStringsArray, ...values: unknown[]) {
      return String.raw({ raw: strings }, ...values).trim();
    },

    dedent(strings: TemplateStringsArray, ...values: unknown[]) {
      const value = String.raw({ raw: strings }, ...values).trim();

      const lines = value.split('\n');

      const indent = Math.min(
        ...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)?.[0].length ?? 0),
      );

      return lines.map(line => line.slice(indent)).join('\n');
    },

    inline(strings: TemplateStringsArray, ...values: unknown[]) {
      return String.raw(strings, ...values)
        .trim()
        .replace(/\s+/g, ' ');
    },
  },
);
