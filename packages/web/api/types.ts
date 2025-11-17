export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface ApiResponse<T = any> {
  status: (statusCode: number) => ApiResponse<T>;
  json: (body: T) => ApiResponse<T>;
}
