// The user's self-declared gender, used only to inflect Polish wording
// about them correctly ("Dołączył" / "Dołączyła"). UNDISCLOSED ("Wolę nie
// odpowiadać") and an unset value (null) both mean the app falls back to
// the neutral form ("Dołączył(a)").
export enum UserGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNDISCLOSED = 'UNDISCLOSED',
}
