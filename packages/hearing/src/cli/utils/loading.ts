import { styleText } from 'node:util';

export function loading(text = 'Loading', interval = 80): () => void {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let index = 0;

  const render = () => {
    const frame = styleText('cyan', frames[index++ % frames.length]);
    process.stdout.write(`\r${frame} ${text}`);
  };

  render();
  const timer = setInterval(render, interval);

  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
  };
}
