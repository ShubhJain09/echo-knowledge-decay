// @vitest-environment jsdom
import React from 'react';
import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import { Button } from '../../components/ui/button';
it('a disabled approval control cannot dispatch a second action',()=>{const handler=vi.fn();render(<Button disabled onClick={handler}>Confirm update</Button>);fireEvent.click(screen.getByRole('button',{name:'Confirm update'}));expect(handler).not.toHaveBeenCalled();});
