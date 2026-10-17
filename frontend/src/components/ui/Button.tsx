import { forwardRef, type ButtonHTMLAttributes } from 'react';
import Spinner from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}
const V = { primary: 'btn-primary', ghost: 'btn-ghost', danger: 'btn-danger', subtle: 'btn text-fg-muted hover:bg-surface-2 hover:text-fg' };
const S = { sm: '!px-2.5 !py-1 text-xs', md: '', lg: '!px-5 !py-2.5' };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, disabled, className = '', children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={`${V[variant]} ${S[size]} ${className}`} {...rest}>
      {loading && <Spinner size={14} />}{children}
    </button>
  );
});
export default Button;
