import { z } from 'zod';

export const NAME_MAX_LENGTH = 200;
export const CUSTOM_TYPE_LABEL_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const LOCATION_NAME_MAX_LENGTH = 255;
export const LOCATION_ADDRESS_MAX_LENGTH = 2000;
export const URL_MAX_LENGTH = 2048;
export const REASON_MAX_LENGTH = 1000;
export const DEPENDENT_DISPLAY_NAME_MAX_LENGTH = 150;

export const isoDateTimeSchema = z.string().datetime({ offset: true });
