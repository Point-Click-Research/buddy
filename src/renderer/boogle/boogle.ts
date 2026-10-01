// The start page's search: the same reading of typed text as the address
// bar, so "nytimes.com" opens the site and anything else is a Google search.

import { typedAddressUrl } from '../../shared/link-text';

const form = document.getElementById('search') as HTMLFormElement;
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = typedAddressUrl(new FormData(form).get('q') as string);
  if (url) location.href = url;
});
