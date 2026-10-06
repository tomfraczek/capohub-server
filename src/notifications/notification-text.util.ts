// Short, ready-to-display Polish text for push/inbox (module spec section
// 32 - "krótki", with the exact style the spec itself demonstrates, e.g.
// "Trening odwołany"). See notification.entity.ts for why pre-rendered
// text was chosen over a type/payload + frontend-localization model.

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** "12.08.2026 18:00" - plain, locale-independent, no Intl dependency. */
export function formatDateTimePl(date: Date): string {
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export interface NotificationText {
  title: string;
  body: string;
}

export function trainingCancelledText(
  name: string | null,
  startsAt: Date,
): NotificationText {
  return {
    title: 'Trening odwołany',
    body: name
      ? `Trening "${name}" (${formatDateTimePl(startsAt)}) został odwołany.`
      : `Trening ${formatDateTimePl(startsAt)} został odwołany.`,
  };
}

export function trainingTimeChangedText(startsAt: Date): NotificationText {
  return {
    title: 'Zmiana terminu treningu',
    body: `Trening ma teraz inny termin: ${formatDateTimePl(startsAt)}.`,
  };
}

export function trainingLocationChangedText(
  locationName: string | null,
): NotificationText {
  return {
    title: 'Zmiana miejsca treningu',
    body: locationName
      ? `Trening odbędzie się w innym miejscu: ${locationName}.`
      : 'Miejsce treningu zostało zmienione.',
  };
}

export function trainingTrainerChangedText(): NotificationText {
  return {
    title: 'Zmiana prowadzącego',
    body: 'Prowadzący ten trening został zmieniony.',
  };
}

export function trainingReminderText(
  startsAt: Date,
  hoursBefore: 24 | 2,
): NotificationText {
  return {
    title: hoursBefore === 24 ? 'Trening jutro' : 'Trening już wkrótce',
    body: `Przypomnienie: trening ${formatDateTimePl(startsAt)}.`,
  };
}

export function eventInvitationText(eventName: string): NotificationText {
  return {
    title: 'Zaproszenie na wydarzenie',
    body: `Zostałeś zaproszony na wydarzenie "${eventName}".`,
  };
}

export function eventPublishedText(eventName: string): NotificationText {
  return {
    title: 'Nowe wydarzenie',
    body: `Opublikowano nowe wydarzenie "${eventName}".`,
  };
}

export function eventCancelledText(eventName: string): NotificationText {
  return {
    title: 'Wydarzenie odwołane',
    body: `Wydarzenie "${eventName}" zostało odwołane.`,
  };
}

export function eventTimeChangedText(
  eventName: string,
  startsAt: Date,
): NotificationText {
  return {
    title: 'Zmiana terminu wydarzenia',
    body: `Wydarzenie "${eventName}" ma teraz inny termin: ${formatDateTimePl(startsAt)}.`,
  };
}

export function eventLocationChangedText(eventName: string): NotificationText {
  return {
    title: 'Zmiana miejsca wydarzenia',
    body: `Miejsce wydarzenia "${eventName}" zostało zmienione.`,
  };
}

export function eventReminderText(
  eventName: string,
  startsAt: Date,
  hoursBefore: 24 | 2,
): NotificationText {
  return {
    title: hoursBefore === 24 ? 'Wydarzenie jutro' : 'Wydarzenie już wkrótce',
    body: `Przypomnienie: "${eventName}" - ${formatDateTimePl(startsAt)}.`,
  };
}

export function announcementPublishedText(
  title: string,
  isImportant: boolean,
): NotificationText {
  return {
    title: isImportant ? 'Ważny komunikat' : 'Nowy komunikat',
    body: title,
  };
}

export function sectionJoinRequestReceivedText(
  requesterName: string,
): NotificationText {
  return {
    title: 'Nowa prośba o dołączenie',
    body: `${requesterName} chce dołączyć do Twojej sekcji.`,
  };
}

export function sectionJoinRequestApprovedText(): NotificationText {
  return {
    title: 'Prośba zaakceptowana',
    body: 'Twoja prośba o dołączenie została zaakceptowana.',
  };
}

export function sectionJoinRequestRejectedText(): NotificationText {
  return {
    title: 'Prośba odrzucona',
    body: 'Twoja prośba o dołączenie została odrzucona.',
  };
}

export function groupJoinRequestReceivedText(
  requesterName: string,
  groupName: string,
): NotificationText {
  return {
    title: 'Nowa prośba o dołączenie',
    body: `${requesterName} chce dołączyć do grupy „${groupName}”.`,
  };
}

export function groupJoinRequestApprovedText(
  groupName: string,
): NotificationText {
  return {
    title: 'Prośba zaakceptowana',
    body: `Dołączyłeś do grupy „${groupName}” - to teraz Twoja grupa formalna.`,
  };
}

export function groupJoinRequestRejectedText(
  groupName: string,
): NotificationText {
  return {
    title: 'Prośba odrzucona',
    body: `Twoja prośba o dołączenie do grupy „${groupName}” została odrzucona.`,
  };
}

export function sectionInvitationReceivedText(): NotificationText {
  return {
    title: 'Nowe zaproszenie',
    body: 'Zostałeś zaproszony do dołączenia do sekcji.',
  };
}

export function sectionInvitationAcceptedText(
  inviteeName: string,
): NotificationText {
  return {
    title: 'Zaproszenie zaakceptowane',
    body: `${inviteeName} zaakceptował(a) Twoje zaproszenie.`,
  };
}

export function sectionInvitationRejectedText(
  inviteeName: string,
): NotificationText {
  return {
    title: 'Zaproszenie odrzucone',
    body: `${inviteeName} odrzucił(a) Twoje zaproszenie.`,
  };
}

export function hierarchyInvitationReceivedText(): NotificationText {
  return {
    title: 'Propozycja połączenia struktur',
    body: 'Otrzymano propozycję dołączenia do innej struktury organizacyjnej.',
  };
}

export function hierarchyInvitationAcceptedText(): NotificationText {
  return {
    title: 'Propozycja zaakceptowana',
    body: 'Twoja propozycja połączenia struktur została zaakceptowana.',
  };
}

export function hierarchyInvitationRejectedText(): NotificationText {
  return {
    title: 'Propozycja odrzucona',
    body: 'Twoja propozycja połączenia struktur została odrzucona.',
  };
}

export function formalRankRequestReceivedText(
  requesterName: string,
  rankName: string,
): NotificationText {
  return {
    title: 'Prośba o potwierdzenie stopnia',
    body: `${requesterName} prosi o potwierdzenie stopnia ${rankName} w systemie Twojej grupy.`,
  };
}

export function formalRankRequestApprovedText(
  rankName: string,
  groupName: string,
): NotificationText {
  return {
    title: 'Stopień potwierdzony',
    body: `Twój stopień ${rankName} został potwierdzony w systemie grupy „${groupName}”.`,
  };
}

export function formalRankRequestRejectedText(
  rankName: string,
  groupName: string,
): NotificationText {
  return {
    title: 'Stopień nie został potwierdzony',
    body: `Prośba o potwierdzenie stopnia ${rankName} w grupie „${groupName}” została odrzucona. Możesz wybrać stopień ponownie.`,
  };
}

export function formalRankCorrectionRequiredText(): NotificationText {
  return {
    title: 'Wymagana korekta stopnia',
    body: 'Twój formalny stopień wymaga korekty. Zgłoś prawidłowy stopień.',
  };
}

export function formalRankCorrectionSubmittedText(): NotificationText {
  return {
    title: 'Korekta stopnia do przeglądu',
    body: 'Zgłoszono korektę stopnia, która wymaga Twojej decyzji.',
  };
}

export function formalRankCorrectionApprovedText(): NotificationText {
  return {
    title: 'Korekta stopnia zaakceptowana',
    body: 'Twoja korekta formalnego stopnia została zaakceptowana.',
  };
}

export function formalRankCorrectionRejectedText(): NotificationText {
  return {
    title: 'Korekta stopnia odrzucona',
    body: 'Twoja korekta formalnego stopnia została odrzucona.',
  };
}
