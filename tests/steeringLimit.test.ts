import { describe, expect, it } from 'vitest'
import { steeringLimit } from '../src/vehicles/SteeringLimit'
import { peakSlipAngle } from '../src/vehicles/TirePhysics'
import { resolveVehicleConfig, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import porsche from '../public/models/cars/porsche911/vehicle-config.json'
const car = resolveVehicleConfig(porsche as Partial<VehicleConfig>)
const config = {wheelbase:2.52,maxSteerAngle:car.maxSteerAngle,steerFalloffSpeed:car.steerFalloffSpeed,grip:car.tires.grip,peakSlip:peakSlipAngle(car.tires),downforcePerKg:car.downforceCoefficient/car.massKg,steerPeakSlipScale:car.steerPeakSlipScale}

describe('grip-limited steering',()=>{
  it('preserves parking/reverse lock but reduces full lock at road speed',()=>{
    expect(steeringLimit(config,0)).toBe(config.maxSteerAngle)
    for(const speed of [100,160].map(kmh=>kmh/3.6)){
      const previous=config.maxSteerAngle/(1+speed/config.steerFalloffSpeed)
      expect(steeringLimit(config,speed)).toBeLessThan(previous)
      expect(steeringLimit(config,-speed)).toBe(steeringLimit(config,speed))
    }
  })
  it('opens smoothly to the original opposite lock during a drift',()=>{
    const speed=100/3.6,grip=steeringLimit(config,speed),drift=steeringLimit(config,speed,1)
    expect(drift).toBeCloseTo(config.maxSteerAngle*.55)
    expect(steeringLimit(config,speed,.5)).toBeCloseTo((grip+drift)/2)
    expect(drift).toBeGreaterThan(grip*2)
  })
  it('accounts for grip and downforce and permits disabling the new cap',()=>{
    const speed=100/3.6
    expect(steeringLimit(config,speed,0,.5)).toBeLessThan(steeringLimit(config,speed))
    expect(steeringLimit({...config,downforcePerKg:.02},speed)).toBeGreaterThan(steeringLimit(config,speed))
    expect(steeringLimit({...config,steerPeakSlipScale:0},speed)).toBe(config.maxSteerAngle/(1+speed/config.steerFalloffSpeed))
  })
})
