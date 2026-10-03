import { Toaster, toast } from '@replaymark/ds';
import { useEffect } from 'react';

function Demo() {
  useEffect(() => {
    toast.success('Einstellungen gespeichert');
    toast.error('Zustellung fehlgeschlagen', {
      description: 'SMTP-Server antwortet nicht.',
    });
    toast('Gronkh ist jetzt live');
  }, []);
  return (
    <div className="h-64 w-[460px]">
      <Toaster position="top-center" expand offset={16} duration={Infinity} />
    </div>
  );
}

export const Notifications = () => <Demo />;
