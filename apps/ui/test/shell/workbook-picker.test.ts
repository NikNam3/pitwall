// @vitest-environment jsdom
// The workbook picker (spec 7.2): its list is the `workbook-picker` test id, so an e2e spec opens a workbook by name
// inside the picker rather than by its position or by a button named like it anywhere on the page.
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkbookPicker from '../../src/shell/workbooks/WorkbookPicker.svelte';

afterEach(cleanup);

describe('WorkbookPicker', () => {
  it('lists the workbooks by name inside `workbook-picker`; a click opens one', async () => {
    const onPick = vi.fn();
    const { getByTestId } = render(WorkbookPicker, { names: ['car', 'race'], active: 'car', onPick, onClose: () => {} });
    await fireEvent.click(within(getByTestId('workbook-picker')).getByRole('button', { name: 'race' }));
    expect(onPick).toHaveBeenCalledWith('race');
  });
});
