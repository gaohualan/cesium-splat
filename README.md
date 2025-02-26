# 3D Gaussian splatting for CesiumJS

CesiumJS-based implemetation of a renderer for [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), a technique for generating 3D scenes from 2D images. Their project is CUDA-based and needs to run natively on your machine, but I wanted to build a viewer that was accessible via the web.

The 3D scenes are stored in a format similar to point clouds and can be viewed, navigated, and interacted with in real-time. This renderer will work with standard `.splat` files.

When I started, web-based viewers were already available -- A WebGL-based viewer from [antimatter15](https://github.com/antimatter15/splat) and a WebGPU viewer from [cvlab-epfl](https://github.com/cvlab-epfl/gaussian-splatting-web) --  A CesiumJS-based viewer from [TheBell](https://github.com/TheBell/CesiumSplatViewer) doesn't work properly . I used those versions as a starting point for my initial implementation.
<br>
<br>
## How to use

install dependencies:

```sh
pnpm install
```

start your local server:

```sh
node server.js
```

visit the page:


  ```JavaScript
  http://localhost:8081/index.html?url=http://localhost:8081/data/model.splat
  ```
## What to do next
[1] support data update.

[2] Optimize rendering effects.


## Thanks
[1] https://github.com/antimatter15/splat

[2] https://github.com/CesiumGS/cesium/blob/main/Apps/Sandcastle/gallery/development/Custom%20Primitive.html

[3] https://github.com/TheBell/CesiumSplatViewer

