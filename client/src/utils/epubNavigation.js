const DEFAULT_MANAGER_QUEUE_TIMEOUT_MS = 600;

function isHorizontalLtrContinuousManager(manager) {
  return manager?.name === 'continuous' &&
    manager?.settings?.axis === 'horizontal' &&
    (manager?.settings?.direction || 'ltr') === 'ltr';
}

function readManagerViews(manager) {
  return manager?.views?.all?.() || manager?.views?._views;
}

function managerQueueTimeout(options) {
  return Number.isFinite(options?.managerQueueTimeoutMs)
    ? Math.max(0, options.managerQueueTimeoutMs)
    : DEFAULT_MANAGER_QUEUE_TIMEOUT_MS;
}

export function stabilizeContinuousManagerLayout(rendition, environment = {}) {
  const manager = rendition?.manager;
  const originalErase = manager?.erase;
  const requestFrame = environment.requestAnimationFrame || globalThis.requestAnimationFrame;
  const cancelFrame = environment.cancelAnimationFrame || globalThis.cancelAnimationFrame;
  if (!isHorizontalLtrContinuousManager(manager)) return () => {};

  const containerStyle = manager.container?.style;
  const previousOverflowAnchor = containerStyle?.overflowAnchor;
  if (containerStyle) {
    // ContinuousViewManager already compensates both prepends and trims.
    // Native scroll anchoring would apply the same offset a second time.
    containerStyle.overflowAnchor = 'none';
  }
  const restoreOverflowAnchor = () => {
    if (containerStyle?.overflowAnchor === 'none') {
      containerStyle.overflowAnchor = previousOverflowAnchor;
    }
  };

  if (typeof originalErase !== 'function' || typeof requestFrame !== 'function') {
    return restoreOverflowAnchor;
  }

  let pendingAnchor = null;
  let stabilizationFrame = null;

  const visibleAnchor = (removedView) => {
    const scrollLeft = Number(manager.container?.scrollLeft);
    const views = readManagerViews(manager);
    if (!Number.isFinite(scrollLeft) || !Array.isArray(views)) return null;

    const view = views.find((candidate) => {
      if (candidate === removedView) return false;
      const left = Number(candidate?.element?.offsetLeft);
      const width = Number(candidate?.element?.offsetWidth);
      return Number.isFinite(left) && Number.isFinite(width) && width > 0 &&
        left <= scrollLeft + 1 && left + width > scrollLeft + 1;
    });
    const left = Number(view?.element?.offsetLeft);
    return view && Number.isFinite(left)
      ? { relativeLeft: left - scrollLeft, view }
      : null;
  };

  const stabilizePendingAnchor = () => {
    stabilizationFrame = null;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    if (!anchor) return;

    const views = readManagerViews(manager);
    if (!Array.isArray(views) || !views.includes(anchor.view)) return;

    const anchorLeft = Number(anchor.view?.element?.offsetLeft);
    const scrollLeft = Number(manager.container?.scrollLeft);
    if (!Number.isFinite(anchorLeft) || !Number.isFinite(scrollLeft)) return;

    const targetScrollLeft = Math.max(0, anchorLeft - anchor.relativeLeft);
    if (Math.abs(scrollLeft - targetScrollLeft) <= 1) return;

    if (typeof manager.scrollTo === 'function') {
      manager.scrollTo(targetScrollLeft, 0, true);
    } else if (manager.container) {
      manager.container.scrollLeft = targetScrollLeft;
    }
  };

  const stabilizedErase = function stabilizedErase(view, ...args) {
    pendingAnchor ||= visibleAnchor(view);
    const result = originalErase.call(this, view, ...args);
    if (pendingAnchor && stabilizationFrame === null) {
      stabilizationFrame = requestFrame(stabilizePendingAnchor);
    }
    return result;
  };

  manager.erase = stabilizedErase;
  return () => {
    if (manager.erase === stabilizedErase) manager.erase = originalErase;
    if (stabilizationFrame !== null && typeof cancelFrame === 'function') {
      cancelFrame(stabilizationFrame);
    }
    stabilizationFrame = null;
    pendingAnchor = null;
    restoreOverflowAnchor();
  };
}

export async function readRenditionLocation(rendition) {
  const location = rendition?.currentLocation?.();
  return location && typeof location.then === 'function' ? location : Promise.resolve(location);
}

function isSameDisplayedPage(first, second) {
  return Number(first?.start?.index) === Number(second?.start?.index) &&
    Number(first?.start?.displayed?.page) === Number(second?.start?.displayed?.page);
}

function enqueueContinuousManagerQueueBarrier(manager) {
  if (typeof manager?.q?.enqueue !== 'function') return null;
  return Promise.resolve()
    .then(() => manager.q.enqueue(() => undefined))
    .then(() => true, () => false);
}

function waitForQueueBarrier(queueBarrier, timeoutMs) {
  let timeoutId;
  const timeoutResult = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([queueBarrier, timeoutResult])
    .finally(() => clearTimeout(timeoutId));
}

export function waitForContinuousManagerQueue(
  manager,
  timeoutMs = DEFAULT_MANAGER_QUEUE_TIMEOUT_MS,
) {
  const queueBarrier = enqueueContinuousManagerQueueBarrier(manager);
  return queueBarrier
    ? waitForQueueBarrier(queueBarrier, timeoutMs)
    : Promise.resolve(false);
}

export async function displayRenditionTarget(rendition, target, options = {}) {
  if (!target || typeof rendition?.display !== 'function') return false;

  const manager = rendition.manager;
  const managerQueueTimeoutMs = managerQueueTimeout(options);
  const shouldContinue = typeof options.shouldContinue === 'function'
    ? options.shouldContinue
    : () => true;
  if (manager?.name === 'continuous') {
    // display() has its own rendition queue but mutates the same views as the
    // continuous manager queue. Let pending preload/trim work finish first.
    await waitForContinuousManagerQueue(manager, managerQueueTimeoutMs);
  }

  if (!shouldContinue()) return false;

  await Promise.resolve(rendition.display(target));
  return true;
}

export async function navigateBasicRenditionPage(rendition, direction, options = {}) {
  const manager = rendition?.manager;
  const navigate = direction === 'next' ? rendition?.next : rendition?.prev;
  const managerQueueTimeoutMs = managerQueueTimeout(options);
  const shouldContinue = typeof options.shouldContinue === 'function'
    ? options.shouldContinue
    : () => true;
  const firstView = manager?.views?.first?.();
  const scrollLeft = Number(manager?.container?.scrollLeft);
  const shouldSettleContinuousPrevious = direction === 'prev' &&
    isHorizontalLtrContinuousManager(manager);
  const canLoadPreviousView = shouldSettleContinuousPrevious &&
    Number.isFinite(scrollLeft) &&
    Math.abs(scrollLeft) <= 1 &&
    Boolean(firstView?.section?.prev?.());
  const firstSectionIndex = canLoadPreviousView
    ? Number(firstView?.section?.index)
    : Number.NaN;
  const initialLocation = canLoadPreviousView
    ? await readRenditionLocation(rendition).catch(() => null)
    : null;

  const result = await Promise.resolve(navigate?.call(rendition));
  let queueBarrier = null;
  let queueSettled = false;
  if (shouldSettleContinuousPrevious) {
    queueBarrier = enqueueContinuousManagerQueueBarrier(manager);
    if (queueBarrier) {
      queueSettled = await waitForQueueBarrier(queueBarrier, managerQueueTimeoutMs);
    }
  }
  const startedAtFirstLoadedPage = Number.isInteger(firstSectionIndex) &&
    Number(initialLocation?.start?.index) === firstSectionIndex &&
    Number(initialLocation?.start?.displayed?.page) === 1;
  if (!startedAtFirstLoadedPage) return result;

  const completePreviousTurn = async () => {
    if (!shouldContinue()) return { completed: false, result: undefined };
    const currentLocation = await readRenditionLocation(rendition).catch(() => null);
    const nextFirstSectionIndex = Number(manager?.views?.first?.()?.section?.index);
    if (
      !shouldContinue() ||
      !isSameDisplayedPage(initialLocation, currentLocation) ||
      !Number.isInteger(nextFirstSectionIndex) ||
      nextFirstSectionIndex >= firstSectionIndex
    ) {
      return { completed: false, result: undefined };
    }

    // At the left edge epub.js uses the first prev() call to prepend a view,
    // then reports the unchanged page. Complete the requested turn now that
    // the predecessor is present instead of requiring a second key press.
    const nextResult = await Promise.resolve(navigate?.call(rendition));
    await waitForContinuousManagerQueue(manager, managerQueueTimeoutMs);
    return { completed: true, result: nextResult };
  };

  const completion = await completePreviousTurn();
  if (completion.completed) return completion.result;

  if (!queueSettled && queueBarrier) {
    // A timeout keeps input responsive, but the queued prepend may still be
    // valid. Finish this same turn when it settles, provided the reader has
    // not moved in the meantime.
    void queueBarrier.then((settled) => (
      settled ? completePreviousTurn() : null
    )).catch(() => {});
  }

  return result;
}
