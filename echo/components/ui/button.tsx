import * as React from 'react';
import { cva,type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
const buttonVariants=cva('button',{variants:{variant:{default:'primary',secondary:'secondary',ghost:'ghost',destructive:'danger'},size:{default:'',sm:'small-button'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof buttonVariants>){return <button className={twMerge(clsx(buttonVariants({variant,size}),className))} {...props}/>;}
