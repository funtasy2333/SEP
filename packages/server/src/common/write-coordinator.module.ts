import { Module } from '@nestjs/common';
import { WriteCoordinator } from './write-coordinator';

/**
 * 提供全应用共享的 {@link WriteCoordinator}。
 *
 * 不用 `@Global()`：需要写库的模块（DocumentModule、VersionModule）显式导入它，依赖关系一目了然，
 * 也不要求每个测试应用（或将来的新入口）记得在根模块里额外注册一次。
 * 本模块不依赖任何其他模块，所以不会引入循环依赖。
 */
@Module({
  providers: [WriteCoordinator],
  exports: [WriteCoordinator],
})
export class WriteCoordinatorModule {}
