import { Toaster as Sonner } from 'sonner';
import { useTheme } from 'next-themes';

function Toaster(props) {
  const { theme = 'system' } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'bg-card text-card-foreground border-border',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from 'sonner';
