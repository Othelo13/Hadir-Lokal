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
}
export interface MemberRecapResponse {
 month:string;
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
 month?:string;
 q?:string;
 page?:number;
 pageSize?:10|20|50;
}
