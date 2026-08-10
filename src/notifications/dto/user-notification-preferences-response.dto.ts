export interface UserNotificationPreferencesResponseDto {
  pushEnabled: boolean;
  pushCommunity: boolean;
  pushTraining: boolean;
  pushEvent: boolean;
  pushMembership: boolean;
  pushGraduation: boolean;
  pushPayment: boolean;
  trainingReminder24h: boolean;
  trainingReminder2h: boolean;
  eventReminder24h: boolean;
  eventReminder2h: boolean;
}
