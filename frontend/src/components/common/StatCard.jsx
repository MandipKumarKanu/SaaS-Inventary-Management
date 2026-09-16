import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatCard({ title, value, icon: Icon, badge, isLoading, className }) {
  return (
    <Card className={cn(className)}>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-muted-foreground">{title}</span>
          {Icon ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-[18px] w-[18px]" />
            </div>
          ) : null}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <span className="text-[28px] font-extrabold leading-none tracking-tight text-foreground">{value}</span>
          )}
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}
