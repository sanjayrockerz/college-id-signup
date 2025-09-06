import { Injectable } from '@nestjs/common';

export interface DatabaseConfig {
  url: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema: string;
  ssl: boolean;
  poolSize: number;
  connectionTimeout: number;
  queryTimeout: number;
  enableLogging: boolean;
}

@Injectable()
export class DatabaseConfigService {
  get config(): DatabaseConfig {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    return {
      url: process.env.DATABASE_URL || this.buildDatabaseUrl(),
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'college_chat_db',
      schema: process.env.DB_SCHEMA || 'public',
      ssl: process.env.DB_SSL === 'true',
      poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10),
      queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10),
      enableLogging: process.env.DB_LOGGING === 'true' || isDevelopment,
    };
  }

  private buildDatabaseUrl(): string {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const username = process.env.DB_USERNAME || 'postgres';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'college_chat_db';
    const ssl = process.env.DB_SSL === 'true';
    const sslParam = ssl ? '?sslmode=require' : '';
    return `postgresql://${username}:${password}@${host}:${port}/${database}${sslParam}`;
  }

  get isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
}
