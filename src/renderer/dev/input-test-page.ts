// The dev input-test page: counts clicks, reports double-clicks, slider
// drags, scrolling and typing, so every InputDriver capability is visible.

const statusLine = document.getElementById('status')!;
const report = (text: string): void => {
  statusLine.textContent = text;
};

let clicks = 0;
const clickCount = document.getElementById('click-count')!;
document.getElementById('click-btn')!.addEventListener('click', () => {
  clickCount.textContent = String(++clicks);
  report(`Clicked ${clicks} time(s).`);
});

document.getElementById('dbl-box')!.addEventListener('dblclick', (event) => {
  (event.currentTarget as HTMLElement).textContent = 'Double-clicked ✓';
  report('Double-click received.');
});

const slider = document.getElementById('slider') as HTMLInputElement;
const sliderValue = document.getElementById('slider-value')!;
slider.addEventListener('input', () => {
  sliderValue.textContent = slider.value;
  report(`Slider dragged to ${slider.value}.`);
});

const scrollBox = document.getElementById('scroll-box')!;
scrollBox.innerHTML = Array.from({ length: 40 }, (_, i) => `<p>Scroll line ${i + 1}</p>`).join('');
scrollBox.addEventListener('scroll', () => {
  report(`Scrolled to ${Math.round(scrollBox.scrollTop)}px.`);
});

for (const id of ['short-text', 'long-text']) {
  document.getElementById(id)!.addEventListener('input', (event) => {
    const el = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    report(`${id}: ${el.value.length} character(s).`);
  });
}
