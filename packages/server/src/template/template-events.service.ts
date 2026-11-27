import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type TemplateChangeAction = 'created' | 'updated' | 'deleted' | 'imported';

export interface TemplateChangeEvent {
  templateId: number;
  uid: string;
  revision: number;
  action: TemplateChangeAction;
  source: 'human' | 'agent' | 'import';
  at: string;
}

export const TEMPLATE_EVENTS_HEARTBEAT_MS = 'TEMPLATE_EVENTS_HEARTBEAT_MS';
export const DEFAULT_TEMPLATE_HEARTBEAT_MS = 15_000;
export const TEMPLATE_CHANGED_EVENT = 'template-changed';

@Injectable()
export class TemplateEventsService implements OnModuleDestroy {
  private readonly changes = new Subject<TemplateChangeEvent>();
  private subscribers = 0;

  publish(event: TemplateChangeEvent): void {
    this.changes.next(event);
  }

  events(): Observable<TemplateChangeEvent> {
    return new Observable<TemplateChangeEvent>((subscriber) => {
      this.subscribers += 1;
      const subscription = this.changes.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        this.subscribers = Math.max(0, this.subscribers - 1);
      };
    });
  }

  subscriberCount(): number {
    return this.subscribers;
  }

  onModuleDestroy(): void {
    this.changes.complete();
  }
}
