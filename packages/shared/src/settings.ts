// Default values for the Setting table (SPEC 7.1). Seed writes these; services fall back to them.
type Priority = 'HOT' | 'WARM' | 'COLD';
type OrderBandCode = 'LT_5M' | 'B5_10M' | 'B10_30M' | 'B30_50M' | 'GT_50M' | 'UNKNOWN';

export interface SettingValues {
  'sla.businessHoursOnly': boolean;
  'assignment.outOfHoursMode': 'ASSIGN_NOW' | 'HOLD';
  'assignment.keepCustomerOwner': boolean;
  'assignment.preferPreviousOwner': boolean;
  'assignment.reclaimOnContactSlaBreach': boolean;
  'priority.byOrderBand': Record<OrderBandCode, Priority>;
  'quote.validDays': number;
  'quote.maxExtraDiscountPct': number;
  'quote.followUpBusinessDays': number;
  'reorder.defaultCycleDays': number;
  'reorder.remindBeforeDays': number;
  'reorder.dormantDays': number;
  'lead.staleDays': number;
  'notify.dailyDigestTime': string;
  'notify.zaloOutsideHours': boolean;
  'facebook.standardWindowHours': number;
  'facebook.humanAgentWindowDays': number;
  'facebook.useHumanAgentTag': boolean;
  'zaloCompany.mode': 'QUICK_CAPTURE' | 'GATEWAY';
  'zaloCompany.minSecondsBetweenMessages': number;
  'zaloCompany.maxMessagesPerDay': number;
  'woo.syncIntervalHours': number;
  'calendar.holidaysConfirmedYears': number[];
}

export const SETTING_DEFAULTS: SettingValues = {
  'sla.businessHoursOnly': true,
  'assignment.outOfHoursMode': 'ASSIGN_NOW',
  'assignment.keepCustomerOwner': true,
  'assignment.preferPreviousOwner': true,
  'assignment.reclaimOnContactSlaBreach': false,
  'priority.byOrderBand': {
    GT_50M: 'HOT',
    B30_50M: 'HOT',
    B10_30M: 'WARM',
    B5_10M: 'WARM',
    LT_5M: 'COLD',
    UNKNOWN: 'COLD',
  },
  'quote.validDays': 7,
  'quote.maxExtraDiscountPct': 0,
  'quote.followUpBusinessDays': 2,
  'reorder.defaultCycleDays': 30,
  'reorder.remindBeforeDays': 3,
  'reorder.dormantDays': 90,
  'lead.staleDays': 5,
  'notify.dailyDigestTime': '08:00',
  'notify.zaloOutsideHours': false,
  // Meta values must be re-checked against current Messenger Platform docs in M3 (SPEC 0.1.5).
  'facebook.standardWindowHours': 24,
  'facebook.humanAgentWindowDays': 7,
  'facebook.useHumanAgentTag': false,
  'zaloCompany.mode': 'QUICK_CAPTURE',
  'zaloCompany.minSecondsBetweenMessages': 3,
  'zaloCompany.maxMessagesPerDay': 300,
  'woo.syncIntervalHours': 6,
  // Năm mà Owner đã xác nhận lịch nghỉ lễ; năm hiện tại chưa có → nhắc trên trang chủ (SPEC 6.1).
  'calendar.holidaysConfirmedYears': [],
};

export type SettingKey = keyof SettingValues;
