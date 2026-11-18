import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '../../core/producer/engine/producer-settings';
import type { SettingsField } from '../../core/producer/engine/producer-settings.model';
import { ProducerStoreStub, provideStoreStub } from '../../core/producer/testing/store-stub';
import { Settings } from './settings';

describe('Settings', () => {
  let stub: ProducerStoreStub;
  let fixture: ComponentFixture<Settings>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (id: SettingsField): HTMLInputElement => {
    const el = host().querySelector<HTMLInputElement>(`#${id}`);
    if (el === null) throw new Error(`input #${id} missing`);
    return el;
  };
  /** Types into a field the way a user does: set the text, fire `input`, then `blur`. */
  const type = (id: SettingsField, text: string): void => {
    input(id).value = text;
    input(id).dispatchEvent(new Event('input'));
    input(id).dispatchEvent(new Event('blur'));
  };
  const button = (label: string): HTMLButtonElement => {
    const el = [...host().querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    if (el === undefined) throw new Error(`button ${label} missing`);
    return el;
  };
  const errorText = (id: SettingsField): string | undefined =>
    host().querySelector(`#${id}-error`)?.textContent.trim();
  const values = (): number[] =>
    (['instrumentCount', 'updatesPerBatch', 'batchIntervalMs'] as const).map((id) =>
      Number(input(id).value),
    );

  beforeEach(async () => {
    stub = new ProducerStoreStub();
    TestBed.configureTestingModule({ providers: [provideStoreStub(stub)] });
    fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
  });

  describe('form (6.2)', () => {
    it('starts from the applied settings 5 / 100 / 500, with a 200 updates/s nominal rate', async () => {
      // Arrange
      const shown = values();

      // Act
      await fixture.whenStable();

      // Assert
      expect(shown).toEqual([5, 100, 500]);
      expect(host().querySelector('.rate')?.textContent).toContain('Nominal rate: 200 updates/s');
      expect(button('Apply').disabled).toBe(false);
    });

    it('0 instruments ⇒ "Must be between 1 and 50", field invalid, Apply disabled', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      type('instrumentCount', '0');
      await fixture.whenStable();

      // Assert
      expect(errorText('instrumentCount')).toBe('Must be between 1 and 50');
      expect(input('instrumentCount').getAttribute('aria-invalid')).toBe('true');
      expect(input('instrumentCount').getAttribute('aria-describedby')).toBe(
        'instrumentCount-hint instrumentCount-error',
      );
      expect(button('Apply').disabled).toBe(true);
      expect(host().querySelector('.rate')?.textContent).toContain('Nominal rate: — updates/s');
    });

    it('1.5 ⇒ "Must be a whole number"', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      type('updatesPerBatch', '1.5');
      await fixture.whenStable();

      // Assert
      expect(errorText('updatesPerBatch')).toBe('Must be a whole number');
      expect(button('Apply').disabled).toBe(true);
    });

    it('an emptied field is invalid', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      type('batchIntervalMs', '');
      await fixture.whenStable();

      // Assert
      expect(errorText('batchIntervalMs')).toBeDefined();
      expect(button('Apply').disabled).toBe(true);
    });

    it('updates the nominal rate live while typing', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      type('updatesPerBatch', '1000');
      type('batchIntervalMs', '50');
      await fixture.whenStable();

      // Assert
      expect(host().querySelector('.rate')?.textContent).toContain(
        'Nominal rate: 20,000 updates/s',
      );
    });

    it('input limits come from the schema (SETTINGS_LIMITS), never from template attributes', async () => {
      // Arrange
      const inputs = [...host().querySelectorAll('input')];

      // Act
      await fixture.whenStable();

      // Assert — [formField] mirrors the schema's min()/max() onto the native input
      expect(inputs.map((el) => [el.id, el.min, el.max, el.hasAttribute('value')])).toEqual([
        [
          'instrumentCount',
          String(SETTINGS_LIMITS.instrumentCount.min),
          String(SETTINGS_LIMITS.instrumentCount.max),
          false,
        ],
        [
          'updatesPerBatch',
          String(SETTINGS_LIMITS.updatesPerBatch.min),
          String(SETTINGS_LIMITS.updatesPerBatch.max),
          false,
        ],
        [
          'batchIntervalMs',
          String(SETTINGS_LIMITS.batchIntervalMs.min),
          String(SETTINGS_LIMITS.batchIntervalMs.max),
          false,
        ],
      ]);
      expect(inputs.every((el) => host().querySelector(`label[for="${el.id}"]`) !== null)).toBe(
        true,
      );
    });
  });

  describe('editing never reaches the producer (6.3)', () => {
    it('changed values without Apply ⇒ apply not called, store settings unchanged', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      type('instrumentCount', '20');
      type('batchIntervalMs', '100');
      await fixture.whenStable();

      // Assert
      expect(stub.calls).toEqual([]);
      expect(stub.settings()).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('apply and reset (6.4)', () => {
    it('Apply with valid values calls store.apply once with integers and confirms the run', async () => {
      // Arrange
      type('instrumentCount', '10');
      type('updatesPerBatch', '200');
      type('batchIntervalMs', '250');
      await fixture.whenStable();

      // Act
      button('Apply').click();
      await fixture.whenStable();

      // Assert
      expect(stub.applied).toEqual([
        { instrumentCount: 10, updatesPerBatch: 200, batchIntervalMs: 250 },
      ]);
      expect(host().querySelector('[role="status"]')?.textContent.trim()).toBe(
        'Run #2 started with 10 instruments, 200 updates every 250 ms.',
      );
      expect(values()).toEqual([10, 200, 250]);
      expect(errorText('instrumentCount')).toBeUndefined();
    });

    it('Reset to defaults fills the form only; nothing is applied', async () => {
      // Arrange
      type('instrumentCount', '42');
      type('updatesPerBatch', '7');
      await fixture.whenStable();

      // Act
      button('Reset to defaults').click();
      await fixture.whenStable();

      // Assert
      expect(values()).toEqual([5, 100, 500]);
      expect(stub.calls).toEqual([]);
    });

    it('submitting an invalid form (Enter in a field) does not apply and marks every field touched', async () => {
      // Arrange
      input('instrumentCount').value = '99';
      input('instrumentCount').dispatchEvent(new Event('input'));
      await fixture.whenStable();

      // Act
      host()
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      // Assert
      expect(stub.calls).toEqual([]);
      expect(errorText('instrumentCount')).toBe('Must be between 1 and 50');
      expect(host().querySelectorAll('input[aria-invalid="true"]')).toHaveLength(1);
    });

    it('the form re-syncs when the applied settings change elsewhere (new run)', async () => {
      // Arrange
      await fixture.whenStable();

      // Act
      stub.settings.set({ instrumentCount: 3, updatesPerBatch: 30, batchIntervalMs: 300 });
      await fixture.whenStable();

      // Assert
      expect(values()).toEqual([3, 30, 300]);
    });
  });
});
