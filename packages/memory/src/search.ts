const MAX_CHUNK_CHARACTERS = 1600;
const CHUNK_OVERLAP_CHARACTERS = 160;
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').trim().toLocaleLowerCase();
}

export function tokenizeSearchText(text: string): string[] {
  const normalized = normalizeSearchText(text);

  const words = Array.from(wordSegmenter.segment(normalized))
    .filter(segment => segment.isWordLike)
    .map(segment => segment.segment);

  return [...new Set(words)];
}

export function chunkText(text: string): string[] {
  const characters = Array.from(text);

  if (characters.length <= MAX_CHUNK_CHARACTERS) {
    return [text];
  }

  const chunks: string[] = [];
  const step = MAX_CHUNK_CHARACTERS - CHUNK_OVERLAP_CHARACTERS;

  for (let start = 0; start < characters.length; start += step) {
    chunks.push(characters.slice(start, start + MAX_CHUNK_CHARACTERS).join(''));

    if (start + MAX_CHUNK_CHARACTERS >= characters.length) {
      break;
    }
  }

  return chunks;
}
