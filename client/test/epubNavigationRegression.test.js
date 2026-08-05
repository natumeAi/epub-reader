import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { usePageTurnController } from '../src/hooks/usePageTurnController.js';

const PAGE_WIDTH = 564;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function installDom() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/',
  });
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

  return {
    cleanup() {
      dom.window.close();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node;
      else globalThis.Node = previousNode;
      if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
      else globalThis.HTMLElement = previousHTMLElement;
      if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      if (previousCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    },
  };
}

async function mountPageTurnController(options) {
  const { createRoot } = await import('react-dom/client');
  let controller;
  function ControllerHarness() {
    controller = usePageTurnController(options);
    return createElement('output', null, controller.phase);
  }

  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(ControllerHarness));
  });

  return {
    controller: () => controller,
    async cleanup() {
      await act(async () => root.unmount());
    },
  };
}

function createStalledBackwardRendition() {
  const illustrationSection = { index: 37 };
  const textSection = {
    index: 38,
    prev: () => illustrationSection,
  };
  const container = { scrollLeft: 0, style: {} };
  const relocatedListeners = new Set();
  const calls = [];
  let currentSection = textSection;
  let queueReleased = false;
  let releaseQueue;
  const pendingQueue = new Promise((resolve) => {
    releaseQueue = () => {
      queueReleased = true;
      currentSection = illustrationSection;
      resolve();
    };
  });
  const currentLocation = {
    atEnd: false,
    atStart: false,
    start: { cfi: 'epubcfi(/6/4)', displayed: { page: 1, total: 4 }, index: 38 },
  };
  const manager = {
    container,
    name: 'continuous',
    q: {
      enqueue(task) {
        const ready = queueReleased ? Promise.resolve() : pendingQueue;
        return ready.then(() => task.call(manager));
      },
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { first: () => ({ section: currentSection }) },
  };
  const rendition = {
    currentLocation: () => currentLocation,
    manager,
    next() {
      calls.push('next');
      relocatedListeners.forEach((listener) => listener(currentLocation));
    },
    off(eventName, listener) {
      if (eventName === 'relocated') relocatedListeners.delete(listener);
    },
    on(eventName, listener) {
      if (eventName === 'relocated') relocatedListeners.add(listener);
    },
    prev() {
      calls.push('prev');
    },
  };

  return { calls, currentLocation, releaseQueue, rendition };
}

test('moves backward across a publication document boundary through the public controller', async () => {
  const dom = installDom();
  let harness;
  try {
    const queueModule = await import('epubjs/lib/utils/queue.js');
    const EpubQueue = queueModule.default.default;
    const illustrationSection = { index: 37 };
    const textSection = {
      index: 38,
      prev: () => illustrationSection,
    };
    const container = { scrollLeft: 0, style: {} };
    const relocatedListeners = new Set();
    let currentSection = textSection;
    let currentLocation = {
      atStart: false,
      start: { cfi: 'epubcfi(/6/4)', displayed: { page: 1, total: 4 }, index: 38 },
    };
    const manager = {
      container,
      name: 'continuous',
      settings: { axis: 'horizontal', direction: 'ltr' },
      views: { first: () => ({ section: currentSection }) },
    };
    manager.q = new EpubQueue(manager);
    const rendition = {
      currentLocation: () => currentLocation,
      manager,
      off(eventName, listener) {
        if (eventName === 'relocated') relocatedListeners.delete(listener);
      },
      on(eventName, listener) {
        if (eventName === 'relocated') relocatedListeners.add(listener);
      },
      prev() {
        container.scrollLeft = Math.max(0, container.scrollLeft - PAGE_WIDTH);
        if (currentSection === illustrationSection && container.scrollLeft === 0) {
          currentLocation = {
            atStart: false,
            start: {
              cfi: 'epubcfi(/6/2)',
              displayed: { page: 1, total: 1 },
              index: illustrationSection.index,
            },
          };
          relocatedListeners.forEach((listener) => listener(currentLocation));
        }
        manager.q.enqueue(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (currentSection === textSection) {
            currentSection = illustrationSection;
            container.scrollLeft += PAGE_WIDTH;
          }
        });
      },
    };
    harness = await mountPageTurnController({
      currentCfiRef: { current: currentLocation.start.cfi },
      edgeRef: { current: null },
      onNavigationSettled: () => true,
      onPageTurnCommitted: () => true,
      reducedMotion: true,
      renditionRef: { current: rendition },
    });
    let result;
    await act(async () => {
      result = await harness.controller().turnPage('prev');
    });

    assert.equal(result, 'completed');
    assert.equal(currentLocation.start.index, illustrationSection.index);
  } finally {
    await harness?.cleanup();
    dom.cleanup();
  }
});

test('does not let a timed-out backward turn continue after the next public turn', async () => {
  const dom = installDom();
  const { calls, currentLocation, releaseQueue, rendition } = createStalledBackwardRendition();
  const harness = await mountPageTurnController({
    currentCfiRef: { current: currentLocation.start.cfi },
    edgeRef: { current: null },
    onNavigationSettled: () => true,
    onPageTurnCommitted: () => true,
    reducedMotion: true,
    renditionRef: { current: rendition },
  });

  try {
    let firstResult;
    await act(async () => {
      firstResult = await harness.controller().turnPage('prev');
    });
    assert.equal(firstResult, 'failed');

    let secondResult;
    await act(async () => {
      secondResult = await harness.controller().turnPage('next');
    });
    assert.equal(secondResult, 'completed');

    await act(async () => {
      releaseQueue();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    assert.deepEqual(calls, ['prev', 'next']);
  } finally {
    releaseQueue();
    await harness.cleanup();
    dom.cleanup();
  }
});

test('does not let a timed-out backward turn continue into a new drag gesture', async () => {
  const dom = installDom();
  const { calls, currentLocation, releaseQueue, rendition } = createStalledBackwardRendition();
  const adapter = {
    begin(_cfi, { action }) {
      return {
        canNext: true,
        canPrevious: action === 'drag',
        pageWidth: PAGE_WIDTH,
      };
    },
    cancel() {},
    dragBy(distanceX) {
      return {
        effectiveDistanceX: distanceX,
        progress: Math.abs(distanceX) / PAGE_WIDTH,
      };
    },
    inspect: () => ({ available: true, pageWidth: PAGE_WIDTH }),
  };
  const harness = await mountPageTurnController({
    adapter,
    currentCfiRef: { current: currentLocation.start.cfi },
    edgeRef: { current: null },
    onNavigationSettled: () => true,
    onPageTurnCommitted: () => true,
    renditionRef: { current: rendition },
  });

  try {
    let firstResult;
    await act(async () => {
      firstResult = await harness.controller().turnPage('prev');
    });
    assert.equal(firstResult, 'failed');

    const pointerTarget = document.createElement('div');
    pointerTarget.setPointerCapture = () => {};
    await act(async () => {
      harness.controller().handlePointerDown({
        clientX: 300,
        clientY: 200,
        currentTarget: pointerTarget,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'touch',
        timeStamp: 1,
      });
      harness.controller().handlePointerMove({
        cancelable: true,
        clientX: 200,
        clientY: 200,
        currentTarget: pointerTarget,
        pointerId: 1,
        preventDefault() {},
      });
    });

    await act(async () => {
      releaseQueue();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    assert.deepEqual(calls, ['prev']);
  } finally {
    await act(async () => {
      releaseQueue();
      harness.controller().cancelPageTurn('test-cleanup');
    });
    await harness.cleanup();
    dom.cleanup();
  }
});

test('does not display a table-of-contents target after navigation is cancelled', async () => {
  const dom = installDom();
  let releaseQueue;
  const pendingQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });
  const displayedTargets = [];
  const rendition = {
    currentLocation: () => null,
    display(target) {
      displayedTargets.push(target);
    },
    manager: {
      container: { style: {} },
      name: 'continuous',
      q: {
        enqueue(task) {
          return pendingQueue.then(task);
        },
      },
    },
  };
  const harness = await mountPageTurnController({
    currentCfiRef: { current: null },
    edgeRef: { current: null },
    onNavigationSettled: () => true,
    onPageTurnCommitted: () => true,
    reducedMotion: true,
    renditionRef: { current: rendition },
  });

  try {
    let navigation;
    await act(async () => {
      navigation = harness.controller().navigateTo('Text/chapter7.xhtml');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      harness.controller().cancelPageTurn('superseded');
    });
    let result;
    await act(async () => {
      releaseQueue();
      result = await navigation;
    });

    assert.equal(result, 'ignored');
    assert.deepEqual(displayedTargets, []);
  } finally {
    releaseQueue();
    await harness.cleanup();
    dom.cleanup();
  }
});
