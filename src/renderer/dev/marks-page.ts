import type { BuddyApi } from '../../shared/ipc';
// Renders the last marked turn's payload: annotated screenshots, crops, and
// the context text, exactly as the model received them.


const buddy = (window as unknown as { buddy: BuddyApi }).buddy;
const content = document.getElementById('content')!;

void buddy.getLastMarksTurn().then((turn) => {
  if (!turn) return; // the placeholder text stays

  content.replaceChildren();

  const heading = (text: string): HTMLHeadingElement => {
    const node = document.createElement('h2');
    node.textContent = text;
    return node;
  };
  const figure = (label: string, base64: string): HTMLElement => {
    const wrap = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64}`;
    wrap.append(caption, img);
    return wrap;
  };
  const pre = (text: string): HTMLPreElement => {
    const node = document.createElement('pre');
    node.textContent = text;
    return node;
  };

  content.append(heading(`Transcript (${new Date(turn.at).toLocaleTimeString()})`), pre(turn.transcript));

  content.append(heading('Screenshots'));
  for (const image of turn.images) content.append(figure(image.label, image.base64));

  if (turn.crops.length > 0) {
    content.append(heading('Close-ups'));
    const grid = document.createElement('div');
    grid.className = 'crops';
    for (const crop of turn.crops) grid.append(figure(crop.label, crop.base64));
    content.append(grid);
  }

  content.append(heading('Context text'), pre(turn.context));
});
