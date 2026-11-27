import { WarningCircle } from '@phosphor-icons/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Empty } from '../ui';

/**
 * 一页出错时只换掉这一页，侧栏、任务和别的页照常能用。没有它的话，任何一处渲染出错整个窗口都会变黑。
 * 换到别的页会自动清掉错误。
 */
export class PageBoundary extends Component<{ page: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[掌柜] 页面出错', error, info.componentStack);
  }

  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Empty
        icon={WarningCircle}
        title="这一页出错了"
        actions={
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            重新打开这一页
          </Button>
        }
      >
        <span className="selectable mono">{error.message}</span>
      </Empty>
    );
  }
}
