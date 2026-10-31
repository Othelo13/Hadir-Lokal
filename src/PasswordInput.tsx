import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordInput({ id, disabled, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi';

  useEffect(() => {
    const form = inputRef.current?.form;
    const hidePassword = () => setVisible(false);
    form?.addEventListener('reset', hidePassword);
    return () => form?.removeEventListener('reset', hidePassword);
  }, []);

  return (
    <span className="password-field">
      <input
        {...props}
        ref={inputRef}
        id={inputId}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="password-toggle"
        disabled={disabled}
        aria-label={toggleLabel}
        aria-controls={inputId}
        title={toggleLabel}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
      </button>
    </span>
  );
}
