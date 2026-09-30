import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/client';

type AgentContent = TextContent | ImageContent;

export function convertMcpContent(result: CallToolResult): AgentContent[] {
  const content: AgentContent[] = [];

  for (const block of result.content ?? []) {
    content.push(...convertContentBlock(block));
  }

  const hasVisibleContent = content.length > 0;

  if (!hasVisibleContent && result.structuredContent !== undefined) {
    content.push({
      type: 'text',
      text: JSON.stringify(result.structuredContent, null, 2),
    });
  }

  return content;
}

export function mcpErrorMessage(result: CallToolResult): string {
  const content = convertMcpContent(result);

  const text = content
    .filter((item): item is TextContent => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim();

  if (text) {
    return text;
  }

  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }

  return 'MCP tool execution failed';
}

function convertContentBlock(block: ContentBlock): AgentContent[] {
  switch (block.type) {
    case 'text': {
      return [
        {
          type: 'text',
          text: block.text,
        },
      ];
    }

    case 'image': {
      return [
        {
          type: 'image',
          data: block.data,
          mimeType: block.mimeType,
        },
      ];
    }

    case 'audio': {
      return [
        {
          type: 'text',
          text: `[MCP audio: ${block.mimeType}]`,
        },
      ];
    }

    case 'resource_link': {
      return [
        {
          type: 'text',
          text: formatResourceLink(block),
        },
      ];
    }

    case 'resource': {
      return convertEmbeddedResource(block);
    }

    default: {
      return [
        {
          type: 'text',
          text: JSON.stringify(block),
        },
      ];
    }
  }
}

function convertEmbeddedResource(
  block: Extract<ContentBlock, { type: 'resource' }>,
): AgentContent[] {
  const resource = block.resource;

  if ('text' in resource) {
    return [
      {
        type: 'text',
        text: resource.text,
      },
    ];
  }

  if ('blob' in resource && resource.mimeType?.startsWith('image/')) {
    return [
      {
        type: 'image',
        data: resource.blob,
        mimeType: resource.mimeType,
      },
    ];
  }

  return [
    {
      type: 'text',
      text: [
        '[MCP resource]',
        `uri: ${resource.uri}`,
        resource.mimeType ? `mimeType: ${resource.mimeType}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

function formatResourceLink(block: Extract<ContentBlock, { type: 'resource_link' }>): string {
  return [
    '[MCP resource]',
    block.name ? `name: ${block.name}` : undefined,
    `uri: ${block.uri}`,
    block.description ? `description: ${block.description}` : undefined,
    block.mimeType ? `mimeType: ${block.mimeType}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}
