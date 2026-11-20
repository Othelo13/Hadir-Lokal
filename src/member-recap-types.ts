export type MemberRecapPeriod = 'day' | 'week' | 'month';
export type MemberRecapDayState = 'present' | 'absent' | 'leave' | 'sick' | 'pending' | 'ongoing' | 'off' | 'future' | 'unknown' | 'not-applicable';
export interface MemberRecapTime { time:string;timezone:string|null; }
export interface MemberRecapDay {
 date:string;state:MemberRecapDayState;late:boolean;hasDetail:boolean;
 historicalEvidenceOnly?:boolean;
 checkIn:MemberRecapTime|null;checkOut:MemberRecapTime|null;
}
export interface MemberRecapRow {
 userId:string;
 name:string;
 email:string;
 present:number;
 late:number;
 absent:number;
 leave:number;
 sick:number;
 pending:number;
 days:MemberRecapDay[];
}
export interface MemberRecapResponse {
 period:MemberRecapPeriod;
 month:string|null;
 date:string|null;
 startDate:string;
 endDate:string;
 today:string;
 completedDays:number;
 verifiedWorkdays:number;
 unverifiedDates:number;
 q:string;
 rows:MemberRecapRow[];
 page:number;
 pageSize:10|20|50;
 total:number;
 totalPages:number;
}
export interface MemberRecapFilters {
 period?:MemberRecapPeriod;
 month?:string;
 date?:string;
 q?:string;
 page?:number;
 pageSize?:10|20|50;
}
