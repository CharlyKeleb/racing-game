export const optionHelp: Record<string,string> = {
  'Visual quality':'Low reduces rendering detail for smoother play. Medium balances detail and speed. High uses richer materials, shadows and scenery.',
  'Post effects':'Adds finishing effects such as bloom and edge smoothing. Turning these off can improve performance.',
  'Renderer':'WebGL works everywhere. WebGPU (beta) uses the newer graphics API (Metal on Mac, D3D12 or Vulkan elsewhere) and runs tyre smoke, dust and sparks on the GPU, so there can be far more of them. It falls back to WebGL where WebGPU is not supported.',
  'Camera':'Chase follows behind your car. Cockpit places the camera inside the car while driving.',
  'Time of day':'Changes the sky, lighting and visibility during the race. Night also turns on the headlights.',
  'Weather':'Rain brings rainfall, spray thrown up behind every car (it hides the car in front, like real racing in the wet) and an overcast sky with shorter visibility.',
  'Laps':'The number of complete laps needed to finish the race. Your choice is saved for future races.',
  'Quality':'Lower quality reduces rendering work. Choose Low if the game is not running smoothly.',
}
