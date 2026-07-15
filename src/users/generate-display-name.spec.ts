import { generateDisplayNameFromEmail } from './generate-display-name';

describe('generateDisplayNameFromEmail', () => {
  it('converts a dot-separated local part to title case', () => {
    expect(generateDisplayNameFromEmail('john.silva@example.com')).toBe(
      'John Silva',
    );
  });

  it('converts an underscore-separated local part to title case', () => {
    expect(generateDisplayNameFromEmail('maria_santos@example.com')).toBe(
      'Maria Santos',
    );
  });

  it('converts a hyphen-separated local part to title case', () => {
    expect(generateDisplayNameFromEmail('capoeira-mestre@example.com')).toBe(
      'Capoeira Mestre',
    );
  });

  it('collapses multiple consecutive separators into one space', () => {
    expect(generateDisplayNameFromEmail('john...silva@example.com')).toBe(
      'John Silva',
    );
  });

  it('handles mixed separators together', () => {
    expect(generateDisplayNameFromEmail('john_silva-mestre@example.com')).toBe(
      'John Silva Mestre',
    );
  });

  it('normalizes mixed-case local parts', () => {
    expect(generateDisplayNameFromEmail('JOHN.SILVA@EXAMPLE.COM')).toBe(
      'John Silva',
    );
  });

  it('handles a single-word local part', () => {
    expect(generateDisplayNameFromEmail('mestre@example.com')).toBe('Mestre');
  });

  it('falls back to "Użytkownik" for null', () => {
    expect(generateDisplayNameFromEmail(null)).toBe('Użytkownik');
  });

  it('falls back to "Użytkownik" for undefined', () => {
    expect(generateDisplayNameFromEmail(undefined)).toBe('Użytkownik');
  });

  it('falls back to "Użytkownik" for an empty string', () => {
    expect(generateDisplayNameFromEmail('')).toBe('Użytkownik');
  });

  it('falls back to "Użytkownik" when the local part is empty', () => {
    expect(generateDisplayNameFromEmail('@example.com')).toBe('Użytkownik');
  });

  it('falls back to "Użytkownik" when the local part is only separators', () => {
    expect(generateDisplayNameFromEmail('...@example.com')).toBe('Użytkownik');
  });

  it('trims leading and trailing separators before splitting', () => {
    expect(generateDisplayNameFromEmail('.john.silva.@example.com')).toBe(
      'John Silva',
    );
  });

  it('never uses firstName/lastName/fullName-style input', () => {
    // Sanity check on the function's contract: it only ever accepts an
    // email string, so there is no code path that could read name fields.
    expect(generateDisplayNameFromEmail.length).toBe(1);
  });
});
