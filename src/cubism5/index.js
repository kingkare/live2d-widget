// @ts-nocheck
/* global document, window, Event */

// ✅ 核心修复：文件名改回 PascalCase (大驼峰)，否则 Linux 下找不到文件
import { LAppDelegate } from '@demo/LAppDelegate.js';
import * as LAppDefine from '@demo/LAppDefine.js';
import { LAppModel } from '@demo/LAppModel.js';
import { LAppPal } from '@demo/LAppPal.js';
import { LAppView } from '@demo/LAppView.js';
import { LAppTextureManager } from '@demo/LAppTextureManager.js';
import { LAppLive2DManager } from '@demo/LAppLive2DManager.js';
import { LAppGlManager } from '@demo/LAppGlManager.js';

import logger from '../logger.js';

LAppPal.printMessage = () => {};

// 自定义子委托类
class AppSubdelegate {
  constructor() {
    // 手动初始化核心管理器
    this._glManager = new LAppGlManager();
    this._textureManager = new LAppTextureManager();
    this._view = new LAppView();
    this._live2dManager = LAppLive2DManager.getInstance();
    
    this._canvas = null;
    this._frameBuffer = null;
    this._resizeObserver = null;
    this._needResize = false;
  }

  initialize(canvas) {
    if (!this._glManager.initialize(canvas)) {
      return false;
    }

    this._canvas = canvas;

    if (LAppDefine.CanvasSize === 'auto') {
      this.resizeCanvas();
    } else {
      canvas.width = LAppDefine.CanvasSize.width;
      canvas.height = LAppDefine.CanvasSize.height;
    }

    this._textureManager.setGlManager(this._glManager);

    const gl = this._glManager.getGl();

    if (!this._frameBuffer) {
      this._frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._view.initialize();
    this._view.setImages(this._textureManager);

    // 尝试设置 Delegate，如果 SDK 不支持也不会报错，因为我们在 constructor 里初始化了
    if (typeof this._live2dManager.setDelegate === 'function') {
        this._live2dManager.setDelegate(this);
    }

    this._resizeObserver = new window.ResizeObserver(
      (entries) => {
        this._needResize = true;
      }
    );
    this._resizeObserver.observe(this._canvas);

    return true;
  }

  resizeCanvas() {
    if (!this._canvas) return;
    const width = this._canvas.clientWidth;
    const height = this._canvas.clientHeight;
    
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      if(this._view) {
        const ratio = width / height;
        const left = -ratio;
        const right = ratio;
        const bottom = -1.0;
        const top = 1.0;
        this._view.setScreenRect(left, right, bottom, top);
        this._view.setMaxScreenRect(left, right, bottom, top);
      }
    }
  }

  onResize() {
    this.resizeCanvas();
    this._view.initialize();
    
    const gl = this._glManager.getGl();
    if(gl) {
        gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  update() {
    const gl = this._glManager.getGl();
    
    if (!gl || gl.isContextLost()) {
      return;
    }

    if (this._needResize) {
      this.onResize();
      this._needResize = false;
    }

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearDepth(1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._view.render();
  }

  getLive2DManager() {
      return this._live2dManager;
  }
  
  getCanvas() {
      return this._canvas;
  }
  
  isContextLost() {
      const gl = this._glManager.getGl();
      return !gl || gl.isContextLost();
  }
}

// 主委托类
export class AppDelegate extends LAppDelegate {
  constructor() {
    super();
    this._subdelegates = [];
    this._canvases = [];
    this._drawFrameId = null;
  }

  run() {
    const loop = () => {
      LAppPal.updateTime();
      for (let i = 0; i < this._subdelegates.length; i++) {
        this._subdelegates[i].update();
      }
      this._drawFrameId = window.requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this._drawFrameId) {
      window.cancelAnimationFrame(this._drawFrameId);
      this._drawFrameId = null;
    }
  }

  release() {
    this.stop();
    this.releaseEventListener();
    this._subdelegates = []; 
    this._cubismOption = null;
  }

  transformOffset(e) {
    const subdelegate = this._subdelegates[0];
    if (!subdelegate) return { x: 0, y: 0 };

    const rect = subdelegate.getCanvas().getBoundingClientRect();
    const localX = e.pageX - rect.left;
    const localY = e.pageY - rect.top;
    const posX = localX * window.devicePixelRatio;
    const posY = localY * window.devicePixelRatio;
    
    const x = subdelegate._view.transformViewX(posX);
    const y = subdelegate._view.transformViewY(posY);
    return { x, y };
  }

  onMouseMove(e) {
    if (this._subdelegates.length === 0) return;
    const subdelegate = this._subdelegates[0];
    const lapplive2dmanager = subdelegate.getLive2DManager();
    const { x, y } = this.transformOffset(e);
    
    if(!lapplive2dmanager) return;

    lapplive2dmanager.onDrag(x, y);
    
    if (lapplive2dmanager._models && lapplive2dmanager._models.getSize() > 0) {
        const model = lapplive2dmanager._models.at(0);
        // 如果 SDK 版本支持 hitTest，则调用
        if (model && typeof model.hitTest === 'function' && model.hitTest(LAppDefine.HitAreaNameBody, x, y)) {
           // hover logic
        }
    }
  }

  onMouseEnd(e) {
    if (this._subdelegates.length === 0) return;
    const lapplive2dmanager = this._subdelegates[0].getLive2DManager();
    if(lapplive2dmanager) {
        lapplive2dmanager.onDrag(0.0, 0.0);
    }
  }

  onTap(e) {
    if (this._subdelegates.length === 0) return;
    const lapplive2dmanager = this._subdelegates[0].getLive2DManager();
    const { x, y } = this.transformOffset(e);
    
    if (lapplive2dmanager) {
        lapplive2dmanager.onTap(x, y);
        
        if (lapplive2dmanager._models && lapplive2dmanager._models.getSize() > 0) {
            const model = lapplive2dmanager._models.at(0);
            if (model && typeof model.hitTest === 'function' && model.hitTest(LAppDefine.HitAreaNameBody, x, y)) {
                window.dispatchEvent(new Event('live2d:tapbody'));
            }
        }
    }
  }

  initializeEventListener() {
    this.mouseMoveEventListener = this.onMouseMove.bind(this);
    this.mouseEndedEventListener = this.onMouseEnd.bind(this);
    this.tapEventListener = this.onTap.bind(this);

    document.addEventListener('mousemove', this.mouseMoveEventListener, { passive: true });
    document.addEventListener('mouseout', this.mouseEndedEventListener, { passive: true });
    document.addEventListener('pointerdown', this.tapEventListener, { passive: true });
  }

  releaseEventListener() {
    document.removeEventListener('mousemove', this.mouseMoveEventListener);
    document.removeEventListener('mouseout', this.mouseEndedEventListener);
    document.removeEventListener('pointerdown', this.tapEventListener);
    
    this.mouseMoveEventListener = null;
    this.mouseEndedEventListener = null;
    this.tapEventListener = null;
  }

  initializeSubdelegates() {
    const canvas = document.getElementById('live2d');
    if (!canvas) {
        logger.error('Canvas element not found');
        return;
    }
    
    this._canvases.push(canvas);

    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";

    for (let i = 0; i < this._canvases.length; i++) {
      const subdelegate = new AppSubdelegate();
      const result = subdelegate.initialize(this._canvases[i]);
      if (!result) {
        logger.error('Failed to initialize AppSubdelegate');
        return;
      }
      this._subdelegates.push(subdelegate);
    }

    for (let i = 0; i < this._subdelegates.length; i++) {
      if (this._subdelegates[i].isContextLost()) {
        logger.error(`Canvas context lost at index ${i}`);
      }
    }
  }

  changeModel(modelSettingPath) {
    if (this._subdelegates.length === 0) return;

    const segments = modelSettingPath.split('/');
    const modelJsonName = segments.pop();
    const modelPath = segments.join('/') + '/';
    
    const live2dManager = this._subdelegates[0].getLive2DManager();
    
    live2dManager.releaseAllModel();
    
    const instance = new LAppModel();
    instance.loadAssets(modelPath, modelJsonName);
    
    live2dManager._models.pushBack(instance);
  }

  get subdelegates() {
    return this._subdelegates;
  }
}
