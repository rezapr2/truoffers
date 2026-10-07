import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import { escapeRegex } from '../businesses/businesses.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { Capability, RequireCapability } from '../common/permissions';
import { AuditService } from '../scraper/audit/audit.service';
import { BlogPost, BlogPostDocument, BlogPostSchema } from '../schemas/blog.schema';

// An uploaded image (/api/files/public/...) or a full https URL
const IMAGE_URL = /^(\/api\/files\/public\/\S+|https:\/\/\S+|)$/;
const PAGE_SIZE = 12;

class BlogPostDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MaxLength(400) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(50000) body?: string;
  @IsOptional() @IsString() @Matches(IMAGE_URL, { message: 'Upload the cover image again' }) coverUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsIn(['draft', 'published']) status?: string;
  @IsOptional() @IsString() @MaxLength(70) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(170) seoDescription?: string;
}

const PUBLIC_FIELDS = 'slug title excerpt coverUrl tags publishedAt authorName seoTitle seoDescription updatedAt';

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPostDocument>,
    private readonly audit: AuditService,
  ) {}

  async publicList(query: { tag?: string; page?: string }) {
    const filter: Record<string, unknown> = { status: 'published', publishedAt: { $lte: new Date() } };
    if (query.tag) filter.tags = query.tag;
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, tags] = await Promise.all([
      this.posts.find(filter).select(PUBLIC_FIELDS).sort({ publishedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      this.posts.countDocuments(filter),
      this.posts.distinct('tags', { status: 'published' }),
    ]);
    return { items, total, page, pages: Math.ceil(total / PAGE_SIZE), tags: (tags as string[]).sort() };
  }

  async publicPost(slug: string) {
    const post = await this.posts.findOne({ slug: slug.toLowerCase(), status: 'published', publishedAt: { $lte: new Date() } }).select(`${PUBLIC_FIELDS} body`).lean();
    if (!post) throw new NotFoundException('Post not found');
    const related = await this.posts
      .find({ _id: { $ne: post._id }, status: 'published', publishedAt: { $lte: new Date() }, ...(post.tags.length ? { tags: { $in: post.tags } } : {}) })
      .select(PUBLIC_FIELDS)
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean();
    return { post, related };
  }

  async adminList(query: { q?: string; status?: string }) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');
    return this.posts.find(filter).sort({ updatedAt: -1 }).limit(300).lean();
  }

  async adminGet(id: string) {
    const post = Types.ObjectId.isValid(id) ? await this.posts.findById(id).lean() : null;
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private slugFor(input: string) {
    return slugify(input, { lower: true, strict: true }).slice(0, 100);
  }

  async create(dto: BlogPostDto, author: AuthUser) {
    if (!dto.title) throw new BadRequestException('Give the post a title');
    const slug = this.slugFor(dto.slug || dto.title);
    if (!slug) throw new BadRequestException('Choose a web address for the post');
    if (await this.posts.exists({ slug })) throw new ConflictException('A post with that address already exists');
    const post = await this.posts.create({
      ...this.fields(dto),
      slug,
      authorId: new Types.ObjectId(author.userId),
      authorName: author.name,
      ...(dto.status === 'published' ? { publishedAt: new Date() } : {}),
    });
    await this.audit.record({ action: 'blog.post_created', targetType: 'BlogPost', targetId: post._id, after: { title: post.title, slug, status: post.status } });
    return post;
  }

  async update(id: string, dto: BlogPostDto) {
    const post = Types.ObjectId.isValid(id) ? await this.posts.findById(id) : null;
    if (!post) throw new NotFoundException('Post not found');
    const before = { title: post.title, slug: post.slug, status: post.status };
    if (dto.slug !== undefined) {
      const slug = this.slugFor(dto.slug || post.title);
      if (slug !== post.slug && (await this.posts.exists({ slug }))) throw new ConflictException('A post with that address already exists');
      post.slug = slug;
    }
    post.set(this.fields(dto));
    // Publishing for the first time dates the post; unpublishing keeps the date for when it comes back.
    if (dto.status === 'published' && !post.publishedAt) post.publishedAt = new Date();
    await post.save();
    await this.audit.record({ action: 'blog.post_updated', targetType: 'BlogPost', targetId: post._id, before, after: { title: post.title, slug: post.slug, status: post.status } });
    return post;
  }

  async remove(id: string) {
    const post = Types.ObjectId.isValid(id) ? await this.posts.findByIdAndDelete(id) : null;
    if (!post) throw new NotFoundException('Post not found');
    await this.audit.record({ action: 'blog.post_deleted', targetType: 'BlogPost', targetId: id, before: { title: post.title, slug: post.slug } });
    return { deleted: true };
  }

  private fields(dto: BlogPostDto) {
    const { slug: _slug, ...rest } = dto;
    const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, unknown>;
    if (fields.tags) fields.tags = [...new Set((fields.tags as string[]).map((t) => t.trim()).filter(Boolean))];
    if (fields.coverUrl === '') fields.coverUrl = undefined;
    return fields;
  }
}

@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Public()
  @Get()
  list(@Query('tag') tag?: string, @Query('page') page?: string) {
    return this.blog.publicList({ tag, page });
  }

  @Public()
  @Get(':slug')
  post(@Param('slug') slug: string) {
    return this.blog.publicPost(slug);
  }
}

@Controller('admin/blog')
@RequireCapability(Capability.CONTENT_MANAGE)
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  list(@Query('q') q?: string, @Query('status') status?: string) {
    return this.blog.adminList({ q, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.blog.adminGet(id);
  }

  @Post()
  create(@Body() dto: BlogPostDto, @CurrentUser() user: AuthUser) {
    return this.blog.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: BlogPostDto) {
    return this.blog.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.blog.remove(id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: BlogPost.name, schema: BlogPostSchema }])],
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService],
})
export class BlogModule {}
