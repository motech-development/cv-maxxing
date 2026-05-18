// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { SidebarContainer } from '../sidebar-container.js';

test('renders the shared workspace sidebar chrome and scrollport', () => {
  const { container } = render(
    <SidebarContainer>
      <div>Sidebar content</div>
    </SidebarContainer>,
  );

  const sidebarFrame = container.firstElementChild;
  const scrollport = sidebarFrame?.firstElementChild;

  expect(sidebarFrame).not.toBeNull();
  expect(scrollport).not.toBeNull();
  expect(sidebarFrame?.className).toContain('w-[328px]');
  expect(sidebarFrame?.className).toContain('overflow-hidden');
  expect(sidebarFrame?.className).toContain('border-r');
  expect(scrollport?.className).toContain('overflow-y-auto');
  expect(scrollport?.className).toContain('p-5');
});
