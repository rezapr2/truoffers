import { Controller, Get, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument, CategorySchema } from '../schemas/category.schema';
import { Public } from '../common/decorators';

@Controller('categories')
export class CategoriesController {
  constructor(@InjectModel(Category.name) private categoryModel: Model<CategoryDocument>) {}

  @Public()
  @Get()
  list() {
    return this.categoryModel.find().sort({ businessCount: -1, name: 1 });
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }])],
  controllers: [CategoriesController],
})
export class CategoriesModule {}
