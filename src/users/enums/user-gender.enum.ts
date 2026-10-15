// The user's self-declared gender, used to inflect Polish wording about
// them correctly ("Dołączył" / "Dołączyła") and to pick their form of a
// rank title (graduation/rank-name.util.ts). UNDISCLOSED ("Wolę nie
// odpowiadać") and an unset value (null) both mean the app falls back to
// the neutral form ("Dołączył(a)") and the masculine/default rank title -
// but only UNDISCLOSED is an answer (see profileComplete).
export enum UserGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNDISCLOSED = 'UNDISCLOSED',
}
