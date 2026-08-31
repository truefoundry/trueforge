import type { Kysely } from 'kysely';
import type { SessionMetricsChartDataResponse, SessionMetricsMeterResponse } from '../../../schemas/sessionMetrics';
import type {
  GetSessionMetricsChartDataInput,
  GetSessionMetricsInput,
  ISessionMetricsStore,
} from '../../sessionMetricsStore';
import type { Database } from '../types';
import {
  getSessionMetricsChartData as getSessionMetricsChartDataQuery,
  getSessionMetricsMeters as getSessionMetricsMetersQuery,
} from './queries';

export class PostgresSessionMetricsStore implements ISessionMetricsStore {
  constructor(private readonly db: Kysely<Database>) {}

  getSessionMetricsMeters(input: GetSessionMetricsInput): Promise<SessionMetricsMeterResponse> {
    return getSessionMetricsMetersQuery(this.db, input);
  }

  getSessionMetricsChartData(input: GetSessionMetricsChartDataInput): Promise<SessionMetricsChartDataResponse> {
    return getSessionMetricsChartDataQuery(this.db, input);
  }
}
