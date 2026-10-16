// Shapes follow the OpenTelemetry data model; times are epoch milliseconds until OTLP export.

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

export type Resource = { 'service.name': string; 'service.namespace': string; 'deployment.environment': string };

export type SpanKind = 'SERVER' | 'CLIENT' | 'INTERNAL';
export type StatusCode = 'UNSET' | 'OK' | 'ERROR';

export type SpanEvent = { name: string; timeMs: number; attributes: Attributes };

export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  service: string;
  startMs: number;
  endMs: number;
  status: { code: StatusCode; message?: string };
  attributes: Attributes;
  events: SpanEvent[];
};

export const SEVERITY_NUMBER = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 } as const;
export type SeverityText = keyof typeof SEVERITY_NUMBER;

export type LogRecord = {
  id: string;
  timeMs: number;
  service: string;
  severityText: SeverityText;
  severityNumber: number;
  body: string;
  templateId: string;
  attributes: Attributes;
  traceId: string | null;
  spanId: string | null;
};

export type MetricType = 'histogram' | 'sum' | 'gauge';

export type MetricDescriptor = {
  name: string;
  type: MetricType;
  unit: string;
  description: string;
  labelNames: readonly string[];
};

export const NAMESPACE = 'mercadito';
export const ENVIRONMENT = 'production';

export function resourceFor(service: string): Resource {
  return { 'service.name': service, 'service.namespace': NAMESPACE, 'deployment.environment': ENVIRONMENT };
}
