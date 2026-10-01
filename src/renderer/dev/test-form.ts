// Harbor Conference registration: a two-step-plus-review form the agent
// can fill from About me facts. Submit stays on this page.

const form = document.getElementById('reg-form') as HTMLFormElement;
const done = document.getElementById('done')!;
const back = document.getElementById('back') as HTMLButtonElement;
const next = document.getElementById('next') as HTMLButtonElement;
const submit = document.getElementById('submit') as HTMLButtonElement;
const review = document.getElementById('review')!;
const pills = [...document.querySelectorAll('#step-pills span')];
const steps = [...document.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]')];

let step = 0;

function showStep(nextStep: number): void {
  step = nextStep;
  for (const fieldset of steps) {
    fieldset.hidden = Number(fieldset.dataset['step']) !== step;
  }
  back.disabled = step === 0;
  next.hidden = step === steps.length - 1;
  submit.hidden = step !== steps.length - 1;
  for (const [i, pill] of pills.entries()) {
    pill.classList.toggle('on', i === step);
    pill.classList.toggle('done', i < step);
  }
  if (step === steps.length - 1) fillReview();
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function currentFields(): FormControl[] {
  return [...steps[step]!.querySelectorAll<FormControl>('input, select, textarea')];
}

function stepValid(): boolean {
  for (const field of currentFields()) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function fillReview(): void {
  const data = new FormData(form);
  const tracks = data.getAll('tracks').join(', ') || '—';
  const rows: Array<[string, string]> = [
    ['Name', String(data.get('fullName') || '—')],
    ['Email', String(data.get('email') || '—')],
    ['Phone', String(data.get('phone') || '—')],
    ['Company', String(data.get('company') || '—')],
    ['Address', String(data.get('address') || '—')],
    ['Role', String(data.get('role') || '—')],
    ['Attendance', String(data.get('attendance') || '—')],
    ['Sessions', tracks],
    ['Arrival', String(data.get('arrival') || '—')],
    ['Notes', String(data.get('notes') || '—')],
  ];
  review.replaceChildren(
    ...rows.map(([label, value]) => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = label;
      item.append(name, ` ${value}`);
      return item;
    }),
  );
}

back.addEventListener('click', () => {
  if (step > 0) showStep(step - 1);
});

next.addEventListener('click', () => {
  if (!stepValid()) return;
  showStep(step + 1);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!stepValid()) return;
  form.hidden = true;
  document.getElementById('step-pills')!.hidden = true;
  done.hidden = false;
});

showStep(0);
