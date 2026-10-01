// Settings → Shopping: how Buddy shows the products it finds.

import type { ReactElement } from 'react';
import { PRODUCT_BROWSE_OPTIONS } from '../../../shared/product-browse';
import { Card, MenuSelect, SectionHeader } from '../../ui';
import { useSettings } from '../context';

export function ShoppingPage(): ReactElement {
  const { view, patch } = useSettings();
  const browse = PRODUCT_BROWSE_OPTIONS.find((option) => option.value === view.settings.productBrowse);
  return (
    <>
      <SectionHeader title="Showing finds" description="How product pages open once Buddy has a few picks." />
      <Card>
        <MenuSelect
          label="Open pages"
          value={view.settings.productBrowse}
          options={PRODUCT_BROWSE_OPTIONS.map(({ value, label }) => ({ value, label }))}
          info={browse?.detail}
          onSelect={(productBrowse) => void patch({ productBrowse })}
        />
      </Card>
    </>
  );
}
